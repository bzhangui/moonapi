import http from "node:http";
import https from "node:https";
import { performance } from "node:perf_hooks";
import { randomBytes } from "node:crypto";
// Private, bounded, per-case loopback receiver. No application service is reused.
export async function callbackReceiver(
  handle,
  timeout = 1000,
  { tls, path } = {},
) {
  const token = randomBytes(24).toString("hex"),
    records = [],
    sockets = new Set();
  let hits = 0,
    closed = false;
  const handler = async (req, res) => {
    if (req.url?.split("?")[0] !== "/" + token) {
      res.writeHead(404).end();
      return;
    }
    if (++hits > 32) {
      if (hits === 33)
        records.push({
          valid: false,
          code: "callback_request_budget",
          inconclusive: true,
        });
      req.resume();
      res.writeHead(429).end();
      return;
    }
    try {
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 262144) throw new Error("STANDARD_CALLBACK_BYTE_BUDGET");
        chunks.push(chunk);
      }
      const result = await handle({
        method: req.method,
        headers: req.headers,
        url: req.url,
        raw: Buffer.concat(chunks).toString("base64"),
        peer_authorized:
          req.socket.encrypted === true && req.socket.authorized === true,
        peer_fingerprint: req.socket.getPeerCertificate?.()?.fingerprint256,
        path,
      });
      records.push({
        valid: result.valid,
        code: result.code || "",
        ...(result.inconclusive ? { inconclusive: true } : {}),
      });
      res
        .writeHead(result.status || 400, result.headers || {})
        .end(result.body ? Buffer.from(result.body, "base64") : undefined);
    } catch (error) {
      const limited = /(?:STANDARD|MODERN)_[A-Z0-9_]*BUDGET/.test(
        error.message,
      );
      records.push({
        valid: false,
        code: limited ? "callback_budget" : "callback_transport",
        ...(limited ? { inconclusive: true } : {}),
      });
      if (!res.destroyed) res.writeHead(limited ? 503 : 400).end();
    }
  };
  const server = tls
    ? https.createServer(
        { ...tls, requestCert: true, rejectUnauthorized: false },
        handler,
      )
    : http.createServer(handler);
  server.requestTimeout = Math.min(timeout, 30000);
  server.maxConnections = 64;
  server.headersTimeout = Math.min(timeout, 30000);
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `${tls ? "https" : "http"}://127.0.0.1:${server.address().port}/${token}`,
    records,
    async settle() {
      const deadline = performance.now() + timeout;
      // Observe the complete bounded window, including duplicate/late events.
      // This is not an unbounded guarantee about future callbacks.
      while (performance.now() < deadline && records.every((r) => r.valid))
        await new Promise((r) => setTimeout(r, 10));
      return records.length > 0 && records.every((r) => r.valid);
    },
    async close() {
      if (closed) return;
      closed = true;
      for (const s of sockets) s.destroy();
      await new Promise((r) => server.close(r));
    },
  };
}

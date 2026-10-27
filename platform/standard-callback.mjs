import http from "node:http";
import { performance } from "node:perf_hooks";
import { randomBytes } from "node:crypto";
// Private, bounded, per-case loopback receiver. No application service is reused.
export async function callbackReceiver(handle, timeout = 1000) {
  const token = randomBytes(24).toString("hex"),
    records = [],
    sockets = new Set();
  let hits = 0;
  const server = http.createServer(async (req, res) => {
    if (req.url?.split("?")[0] !== "/" + token) {
      res.writeHead(404).end();
      return;
    }
    if (++hits > 32) {
      if (hits === 33)
        records.push({ valid: false, code: "callback_request_budget" });
      req.resume();
      res.writeHead(429).end();
      return;
    }
    try {
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 262144) throw new Error();
        chunks.push(chunk);
      }
      const result = await handle({
        method: req.method,
        headers: req.headers,
        url: req.url,
        raw: Buffer.concat(chunks).toString("base64"),
      });
      records.push({ valid: result.valid, code: result.code || "" });
      res
        .writeHead(result.status || 400, result.headers || {})
        .end(result.body ? Buffer.from(result.body, "base64") : undefined);
    } catch {
      records.push({ valid: false, code: "callback_transport" });
      res.writeHead(400).end();
    }
  });
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
    url: `http://127.0.0.1:${server.address().port}/${token}`,
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
      for (const s of sockets) s.destroy();
      await new Promise((r) => server.close(r));
    },
  };
}

import http from "node:http";
import https from "node:https";
// Unlike fetch, this transport supports TRACE; no redirect or ambient cookie jar.
export function standardHTTP(
  target,
  { method, headers, body, signal, onSent },
) {
  return new Promise((resolve, reject) => {
    const req = (target.protocol === "https:" ? https : http).request(
      target,
      { method, headers, signal },
      (res) => {
        let size = 0;
        const chunks = [];
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > 1048576)
            res.destroy(new Error("STANDARD_RESPONSE_BUDGET"));
          else chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: Object.fromEntries(
              Object.entries(res.headers).map(([k, v]) => [
                k,
                Array.isArray(v) ? v.join(", ") : v || "",
              ]),
            ),
            raw: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on("error", reject);
    req.once("finish", () => {
      try {
        onSent?.();
      } catch {
        req.destroy(new Error("STANDARD_OBSERVER_FAILED"));
      }
    });
    req.on("upgrade", (_res, socket) => {
      socket.destroy();
      reject(new Error("STANDARD_HTTP_UPGRADE"));
    });
    if (
      body !== undefined &&
      method !== "TRACE" &&
      method !== "HEAD" &&
      method !== "GET"
    )
      req.end(body);
    else req.end();
  });
}

import http from "node:http";
import https from "node:https";
import tls from "node:tls";
const responseHeaders = (res) =>
  Object.fromEntries(
    Object.entries(res.headers).map(([k, v]) => [
      k,
      Array.isArray(v)
        ? k.toLowerCase() === "set-cookie"
          ? v
          : v.join(", ")
        : v || "",
    ]),
  );
export function clientTLS(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (k) => !["cert", "key", "ca", "passphrase"].includes(k),
    )
  )
    throw new Error("STANDARD_TLS_CONFIGURATION");
  const output = { rejectUnauthorized: true };
  for (const k of ["cert", "key", "ca", "passphrase"])
    if (value[k] !== undefined) {
      if (typeof value[k] !== "string" && !(value[k] instanceof Uint8Array))
        throw new Error("STANDARD_TLS_CONFIGURATION");
      if (Buffer.byteLength(value[k]) > 65536)
        throw new Error("STANDARD_TLS_CONFIGURATION");
      output[k] =
        value[k] instanceof Uint8Array ? Buffer.from(value[k]) : value[k];
    }
  if (!output.cert || !output.key)
    throw new Error("STANDARD_TLS_CONFIGURATION");
  try {
    tls.createSecureContext(output);
  } catch {
    throw new Error("STANDARD_TLS_CONFIGURATION");
  }
  return output;
}
// Unlike fetch, this transport supports TRACE; no redirect or ambient cookie jar.
export function standardHTTP(
  target,
  {
    method,
    headers,
    body,
    signal,
    onSent,
    tls: security,
    onHeaders,
    onChunk,
    onEnd,
  },
) {
  return new Promise((resolve, reject) => {
    if (security && target.protocol !== "https:")
      return reject(new Error("STANDARD_MUTUAL_TLS_REQUIRED"));
    const transportHeaders = { ...headers },
      expect = transportHeaders.expect;
    delete transportHeaders.expect;
    // Node disables implicit chunked framing for GET/HEAD. Explicitly declared
    // modern content still needs an unambiguous length, otherwise its bytes can
    // be parsed as a second request (400 / request-smuggling ambiguity).
    if (body !== undefined && method !== "TRACE")
      transportHeaders["content-length"] = String(Buffer.byteLength(body));
    const req = (target.protocol === "https:" ? https : http).request(
      target,
      { ...(security ?? {}), method, headers: transportHeaders, signal },
      async (res) => {
        try {
          await onHeaders?.({
            status: res.statusCode,
            headers: responseHeaders(res),
          });
          let size = 0;
          const chunks = [];
          for await (const chunk of res) {
            size += chunk.length;
            if (size > 1048576) throw new Error("STANDARD_RESPONSE_BUDGET");
            await onChunk?.(chunk);
            chunks.push(chunk);
          }
          await onEnd?.();
          resolve({
            status: res.statusCode,
            headers: responseHeaders(res),
            raw: Buffer.concat(chunks),
          });
        } catch (error) {
          res.destroy();
          reject(error);
        }
      },
    );
    // Node upper-cases method in its constructor; set the public method before
    // the implicit header is rendered so additionalOperations retains its token.
    req.method = method;
    if (expect !== undefined) req.setHeader("expect", expect);
    req.on("error", reject);
    req.once("finish", () => {
      try {
        onSent?.();
      } catch {
        req.destroy(new Error("STANDARD_OBSERVER_FAILED"));
      }
    });
    req.on("upgrade", (res, socket) => {
      socket.destroy();
      resolve({
        status: res.statusCode,
        headers: responseHeaders(res),
        raw: Buffer.alloc(0),
      });
    });
    req.on("connect", (res, socket) => {
      socket.destroy();
      resolve({
        status: res.statusCode,
        headers: responseHeaders(res),
        raw: Buffer.alloc(0),
      });
    });
    if (body !== undefined && method !== "TRACE") req.end(body);
    else req.end();
  });
}

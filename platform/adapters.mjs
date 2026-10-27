import { standardHTTP } from "./standard-http.mjs";
export function within(signal, action, code = "ADAPTER_DEADLINE") {
  if (signal?.aborted) return Promise.reject(new Error(code));
  let aborted;
  const cancelled = new Promise((_, reject) => {
    aborted = () => reject(new Error(code));
    signal?.addEventListener("abort", aborted, { once: true });
  });
  return Promise.race([Promise.resolve().then(action), cancelled]).finally(() =>
    signal?.removeEventListener("abort", aborted),
  );
}
export function transportAdapter(adapter) {
  if (adapter === undefined)
    return Object.freeze({
      version: 1,
      id: "node-http-v1",
      send: standardHTTP,
    });
  if (
    !adapter ||
    adapter.version !== 1 ||
    typeof adapter.send !== "function" ||
    !/^[a-zA-Z0-9_.-]{1,64}$/.test(adapter.id)
  )
    throw new Error("STANDARD_TRANSPORT_ADAPTER");
  return Object.freeze({
    version: 1,
    id: adapter.id,
    send: async (target, request) => {
      const result = await within(
        request.signal,
        () => adapter.send(new URL(target), request),
        "STANDARD_TRANSPORT_DEADLINE",
      );
      if (
        !result ||
        !Number.isInteger(result.status) ||
        result.status < 100 ||
        result.status > 599 ||
        !Buffer.isBuffer(result.raw) ||
        result.raw.length > 1048576 ||
        !result.headers ||
        typeof result.headers !== "object"
      )
        throw new Error("STANDARD_TRANSPORT_RESPONSE");
      // Custom transport may not fabricate lifecycle receipts. The orchestrator
      // conservatively retains dispatching if the trusted adapter does not emit sent.
      const headers = Object.create(null);
      let size = 0;
      for (const [key, value] of Object.entries(result.headers)) {
        if (
          !/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(key) ||
          typeof value !== "string" ||
          /[\r\n]/.test(key + value)
        )
          throw new Error("STANDARD_TRANSPORT_HEADERS");
        size += key.length + value.length;
        if (size > 65536) throw new Error("STANDARD_TRANSPORT_HEADERS");
        headers[key.toLowerCase()] = value;
      }
      return { status: result.status, headers, raw: result.raw };
    },
  });
}
export function environmentCredentials(profiles, environment = process.env) {
  if (!profiles || typeof profiles !== "object")
    throw new Error("CREDENTIAL_PROFILES");
  return {
    version: 1,
    id: "environment-v1",
    async resolve({ role = "default" }) {
      const name = Object.hasOwn(profiles, role) ? profiles[role] : undefined;
      if (!/^[A-Z_][A-Z0-9_]{0,127}$/.test(name || ""))
        throw new Error("CREDENTIAL_ROLE");
      const value = environment[name];
      if (typeof value !== "string" || Buffer.byteLength(value) > 16384)
        throw new Error("CREDENTIAL_ENVIRONMENT");
      try {
        return JSON.parse(value);
      } catch {
        throw new Error("CREDENTIAL_ENCODING");
      }
    },
  };
}

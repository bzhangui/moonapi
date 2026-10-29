// Private worker/persistence framing. A business object that resembles a Buffer
// remains an object; only actual byte arrays receive explicit out-of-band slots.
import {
  numeric,
  parseExact,
  stringifyExact,
  setOwn,
} from "./standard-value.mjs";
export function encodeTransfer(value, maxBytes = 4194304) {
  const binaries = [],
    active = new Set();
  let nodes = 0,
    bytes = 0;
  const walk = (v, path = "", depth = 0) => {
    if (++nodes > 100000 || depth > 128)
      throw new Error("STANDARD_TRANSFER_BUDGET");
    if (Buffer.isBuffer(v) || v instanceof Uint8Array) {
      bytes += v.byteLength + Buffer.byteLength(path) + 32;
      if (binaries.length >= 4096 || bytes > maxBytes)
        throw new Error("STANDARD_TRANSFER_BUDGET");
      binaries.push({ path, data: Buffer.from(v) });
      return null;
    }
    if (!v || typeof v !== "object" || numeric(v)) return v;
    if (active.has(v)) throw new Error("STANDARD_TRANSFER_CYCLE");
    active.add(v);
    const out = Array.isArray(v) ? [] : {};
    for (const [k, x] of Object.entries(v))
      setOwn(
        out,
        k,
        walk(
          x,
          path + "/" + k.replace(/~/g, "~0").replace(/\//g, "~1"),
          depth + 1,
        ),
      );
    active.delete(v);
    return out;
  };
  const json = stringifyExact(walk(value));
  if (typeof json !== "string" || Buffer.byteLength(json) + bytes > maxBytes)
    throw new Error("STANDARD_TRANSFER_BUDGET");
  return { format: 1, json, binaries };
}
export function decodeTransfer(frame, maxBytes = 4194304) {
  const checkTree = (value) => {
    const queue = [[value, 0]];
    let nodes = 0;
    while (queue.length) {
      const [v, depth] = queue.pop();
      if (++nodes > 100000 || depth > 128)
        throw new Error("STANDARD_TRANSFER_BUDGET");
      if (
        v &&
        typeof v === "object" &&
        !numeric(v) &&
        !(v instanceof Uint8Array)
      )
        for (const x of Object.values(v)) queue.push([x, depth + 1]);
    }
    return value;
  };
  if (typeof frame === "string") {
    if (Buffer.byteLength(frame) > maxBytes)
      throw new Error("STANDARD_TRANSFER_BUDGET");
    return checkTree(parseExact(frame)); // old worker frames
  }
  if (
    !frame ||
    frame.format !== 1 ||
    typeof frame.json !== "string" ||
    !Array.isArray(frame.binaries) ||
    frame.binaries.length > 4096
  )
    throw new Error("STANDARD_TRANSFER_ENCODING");
  let bytes = Buffer.byteLength(frame.json);
  if (bytes > maxBytes) throw new Error("STANDARD_TRANSFER_BUDGET");
  let value = checkTree(parseExact(frame.json));
  const seen = new Set();
  for (const b of frame.binaries) {
    if (
      !b ||
      typeof b.path !== "string" ||
      seen.has(b.path) ||
      !(b.data instanceof Uint8Array) ||
      (bytes += b.data.byteLength + Buffer.byteLength(b.path) + 32) > maxBytes
    )
      throw new Error("STANDARD_TRANSFER_ENCODING");
    seen.add(b.path);
    if (!b.path) {
      if (value !== null) throw new Error("STANDARD_TRANSFER_ENCODING");
      value = Buffer.from(b.data);
      continue;
    }
    if (!/^\/(?:[^~]|~[01])*$/.test(b.path))
      throw new Error("STANDARD_TRANSFER_ENCODING");
    const keys = b.path
      .slice(1)
      .split("/")
      .map((k) => k.replace(/~1/g, "/").replace(/~0/g, "~"));
    let parent = value;
    for (const k of keys.slice(0, -1)) {
      if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, k))
        throw new Error("STANDARD_TRANSFER_ENCODING");
      parent = parent[k];
    }
    const key = keys.at(-1);
    if (!parent || !Object.hasOwn(parent, key) || parent[key] !== null)
      throw new Error("STANDARD_TRANSFER_ENCODING");
    setOwn(parent, key, Buffer.from(b.data));
  }
  if (bytes > maxBytes) throw new Error("STANDARD_TRANSFER_BUDGET");
  return value;
}
export const cloneTransfer = (value) => decodeTransfer(encodeTransfer(value));

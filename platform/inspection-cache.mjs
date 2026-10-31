import { createHash } from "node:crypto";
import { inspectProject } from "./project-config.mjs";
// Cache metadata only, per local session. No response corpus, credentials,
// targets, raw documents, failures or executable adapters are retained.
export class ProjectInspector {
  #cache = new Map();
  #inflight = new Map();
  #bytes = 0;
  #epoch = 0;
  constructor({ maxEntries = 8, maxBytes = 1048576, ttlMs = 30000 } = {}) {
    if (
      !Number.isInteger(maxEntries) ||
      maxEntries < 1 ||
      maxEntries > 32 ||
      !Number.isInteger(maxBytes) ||
      maxBytes < 1024 ||
      maxBytes > 8388608 ||
      !Number.isInteger(ttlMs) ||
      ttlMs < 1 ||
      ttlMs > 60000
    )
      throw new Error("INSPECTION_CACHE_OPTIONS");
    Object.defineProperty(this, "settings", {
      value: Object.freeze({ maxEntries, maxBytes, ttlMs }),
    });
  }
  get stats() {
    return {
      entries: this.#cache.size,
      bytes: this.#bytes,
      inflight: this.#inflight.size,
      credentials_cached: false,
      raw_documents_cached: false,
    };
  }
  clear() {
    this.#epoch++;
    this.#bytes = 0;
    this.#cache.clear();
  }
  async inspect(source, options = {}) {
    if (
      typeof source !== "string" ||
      Buffer.byteLength(source) > 1048576 ||
      !options ||
      typeof options !== "object" ||
      Array.isArray(options) ||
      Reflect.ownKeys(options).some(
        (k) =>
          ![
            "seed",
            "limit",
            "compilerTimeout",
            "documents",
            "documentURI",
          ].includes(k),
      )
    )
      throw new Error("INSPECTION_CACHE_INPUT");
    try {
      options = structuredClone(options);
    } catch {
      throw new Error("INSPECTION_CACHE_INPUT");
    }
    // Hash exact bytes and every accepted option, not merely version/title/URL.
    let encoded;
    try {
      encoded = JSON.stringify(options);
    } catch {
      throw new Error("INSPECTION_CACHE_INPUT");
    }
    if (
      Buffer.byteLength(encoded) > 4194304 ||
      Object.values(options).some(
        (v) => typeof v === "function" || v === undefined,
      ) ||
      Object.values(options.documents ?? {}).some((v) => typeof v !== "string")
    )
      throw new Error("INSPECTION_CACHE_INPUT");
    const key = createHash("sha256")
      .update(source)
      .update("\0")
      .update(encoded)
      .digest("hex");
    const existing = this.#cache.get(key);
    if (existing && existing.expires > Date.now()) {
      this.#cache.delete(key);
      this.#cache.set(key, existing);
      return { ...structuredClone(existing.value), metadata_cache_hit: true };
    }
    if (existing) {
      this.#cache.delete(key);
      this.#bytes -= existing.bytes;
    }
    if (this.#inflight.has(key))
      return structuredClone(await this.#inflight.get(key));
    if (this.#inflight.size >= 2) throw new Error("INSPECTION_CACHE_BUSY");
    const epoch = this.#epoch;
    const pending = inspectProject(source, options)
      .then((value) => {
        const bytes = Buffer.byteLength(JSON.stringify(value));
        if (epoch === this.#epoch && bytes <= this.settings.maxBytes) {
          while (
            this.#cache.size >= this.settings.maxEntries ||
            this.#bytes + bytes > this.settings.maxBytes
          ) {
            const oldest = this.#cache.keys().next().value;
            this.#bytes -= this.#cache.get(oldest).bytes;
            this.#cache.delete(oldest);
          }
          this.#cache.set(key, {
            value: structuredClone(value),
            bytes,
            expires: Date.now() + this.settings.ttlMs,
          });
          this.#bytes += bytes;
        }
        return { ...value, metadata_cache_hit: false };
      })
      .finally(() => this.#inflight.delete(key));
    this.#inflight.set(key, pending);
    return structuredClone(await pending);
  }
}

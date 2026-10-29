import { createHash } from "node:crypto";
import { cloneExact, equal, stringifyExact } from "./standard-value.mjs";
import { pointer } from "./standard-expression.mjs";
import { loadCore } from "./runner.mjs";
import { digestExact } from "./private-store.mjs";
const safe = /^[A-Za-z0-9_.-]{1,64}$/,
  hex = /^[0-9a-f]{64}$/;
export class ResponseCorpus {
  #binding;
  #sources;
  #values = new Map();
  #bytes = 0;
  #maxBytes;
  #maxValues;
  #unsafe = false;
  #observations = 0;
  #selections = 0;
  #dropped = 0;
  constructor({
    documentBinding,
    environmentBinding,
    sources,
    maxBytes = 131072,
    maxValues = 128,
  } = {}) {
    if (
      ![documentBinding, environmentBinding].every(
        (x) => typeof x === "string" && hex.test(x),
      ) ||
      !Number.isInteger(maxBytes) ||
      maxBytes < 1024 ||
      maxBytes > 262144 ||
      !Number.isInteger(maxValues) ||
      maxValues < 1 ||
      maxValues > 256 ||
      !Array.isArray(sources) ||
      !sources.length ||
      sources.length > 32
    )
      throw new Error("FEEDBACK_CONFIG");
    this.#sources = new Map();
    for (const s of sources) {
      if (
        !s ||
        Object.keys(s).some(
          (k) =>
            ![
              "id",
              "operation",
              "pointer",
              "role",
              "consumers",
              "explode",
            ].includes(k),
        ) ||
        typeof s.id !== "string" ||
        !safe.test(s.id) ||
        this.#sources.has(s.id) ||
        typeof s.operation !== "string" ||
        !s.operation ||
        s.operation.length > 512 ||
        typeof s.pointer !== "string" ||
        s.pointer.length > 2048 ||
        !/^(?:\/(?:[^~/]|~[01])*)*$/.test(s.pointer) ||
        (s.role !== undefined &&
          (typeof s.role !== "string" || !safe.test(s.role))) ||
        (s.explode !== undefined && typeof s.explode !== "boolean") ||
        !Array.isArray(s.consumers) ||
        !s.consumers.length ||
        s.consumers.length > 32 ||
        s.consumers.some((x) => typeof x !== "string" || !x || x.length > 512)
      )
        throw new Error("FEEDBACK_CONFIG");
      this.#sources.set(s.id, { ...cloneExact(s), role: s.role ?? "default" });
    }
    this.#binding = { documentBinding, environmentBinding };
    this.#maxBytes = maxBytes;
    this.#maxValues = maxValues;
  }
  assertScope({ documentBinding, environmentBinding, description }) {
    if (this.#unsafe) throw new Error("FEEDBACK_UNRESOLVED_SIDE_EFFECT");
    if (
      documentBinding !== this.#binding.documentBinding ||
      environmentBinding !== this.#binding.environmentBinding
    )
      throw new Error("FEEDBACK_SCOPE");
    const ids = new Set(description.operations.map((o) => o.id));
    for (const s of this.#sources.values())
      if (!ids.has(s.operation) || s.consumers.some((id) => !ids.has(id)))
        throw new Error("FEEDBACK_OPERATION");
  }
  authorize(source, operation, role = "default") {
    const s = this.#sources.get(source);
    if (!s || s.role !== role || !s.consumers.includes(operation))
      throw new Error("FEEDBACK_SOURCE_NOT_GRANTED");
  }
  observe(operation, role, body) {
    if (this.#unsafe) throw new Error("FEEDBACK_UNRESOLVED_SIDE_EFFECT");
    for (const s of this.#sources.values()) {
      if (s.operation !== operation || s.role !== (role ?? "default")) continue;
      const value = pointer(body, s.pointer);
      const samples =
        s.explode && Array.isArray(value) ? value.slice(0, 16) : [value];
      for (const sample of samples) {
        if (sample === undefined) continue;
        const raw = stringifyExact(sample),
          bytes = Buffer.byteLength(raw);
        if (bytes > 8192 || bytes > this.#maxBytes) {
          this.#dropped++;
          continue;
        }
        if (
          [...this.#values.values()].some(
            (v) => v.source === s.id && equal(v.value, sample),
          )
        )
          continue;
        while (
          this.#values.size >= this.#maxValues ||
          this.#bytes + bytes > this.#maxBytes ||
          [...this.#values.values()].filter((v) => v.source === s.id).length >=
            16
        ) {
          const oldest =
            [...this.#values.values()].find((v) => v.source === s.id) ??
            this.#values.values().next().value;
          if (!oldest) break;
          this.#values.delete(oldest.token);
          this.#bytes -= oldest.bytes;
          this.#dropped++;
        }
        const token = createHash("sha256")
          .update(s.id + "\0" + digestExact(sample))
          .digest("hex");
        this.#values.set(token, {
          token,
          source: s.id,
          value: cloneExact(sample),
          uses: 0,
          bytes,
        });
        this.#bytes += bytes;
        this.#observations++;
      }
    }
  }
  candidates(source, operation, role) {
    if (this.#unsafe) throw new Error("FEEDBACK_UNRESOLVED_SIDE_EFFECT");
    this.authorize(source, operation, role);
    return [...this.#values.values()]
      .filter((v) => v.source === source)
      .map((v) => ({
        token: v.token,
        value: cloneExact(v.value),
        uses: v.uses,
      }));
  }
  async choose(candidates, seed) {
    if (!candidates.length) return undefined;
    if (
      this.#unsafe ||
      !Number.isInteger(seed) ||
      seed < 0 ||
      seed > 1000000 ||
      candidates.length > 16
    )
      throw new Error("FEEDBACK_SELECTION");
    await loadCore();
    const output = JSON.parse(
      globalThis.__moonapi_core(
        JSON.stringify({
          action: "feedback-choice",
          counts: candidates.map((v) => v.uses),
          seed,
        }),
      ),
    );
    if (!output.ok) throw new Error("FEEDBACK_SELECTION");
    const selected = candidates[output.value.index],
      stored = this.#values.get(selected.token);
    if (!stored || !equal(stored.value, selected.value))
      throw new Error("FEEDBACK_STALE_CANDIDATE");
    stored.uses = Math.min(1000000, stored.uses + 1);
    this.#selections++;
    return cloneExact(selected.value);
  }
  markUnsafe() {
    this.#unsafe = true;
  }
  summary() {
    return {
      observations: this.#observations,
      selections: this.#selections,
      values: this.#values.size,
      bytes: this.#bytes,
      dropped: this.#dropped,
      blocked_after_unresolved_side_effect: this.#unsafe,
      persisted: false,
    };
  }
}

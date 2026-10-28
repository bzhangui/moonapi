// Immutable encrypted intent, not a request queue. There is intentionally no
// replay/dispatch API. Credentials and request bodies never enter this store.
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import {
  privateDirectory,
  saveEncryptedWitness,
  loadEncryptedWitness,
} from "./private-store.mjs";
import { within } from "./adapters.mjs";
const digest = (v) => createHash("sha256").update(v).digest("hex");
const hex = /^[0-9a-f]{64}$/;
const idPattern = /^[0-9a-f-]{36}$/;
const fields = [
  "environment_binding",
  "document_binding",
  "model_binding",
  "ownership_digest",
  "request_digest",
  "operation_digest",
];
function checkIntent(value) {
  if (
    !value ||
    value.kind !== "moonapi-execution-intent" ||
    value.format !== 1 ||
    !idPattern.test(value.id) ||
    !Number.isSafeInteger(value.created_at) ||
    !["POST", "PUT", "PATCH", "DELETE", "TRACE"].includes(value.method) ||
    fields.some((k) => !hex.test(value[k])) ||
    value.automatic_replay_permitted !== false ||
    Object.keys(value).some(
      (k) =>
        ![
          ...fields,
          "kind",
          "format",
          "id",
          "created_at",
          "method",
          "automatic_replay_permitted",
        ].includes(k),
    )
  )
    throw new Error("INTENT_INVALID");
  return value;
}
export class ExecutionIntentStore {
  version = 1;
  #directory;
  #key;
  #bindings;
  #closed = false;
  constructor({
    directory,
    key,
    environmentBinding,
    documentBinding,
    modelBinding,
    ownershipMarker,
  } = {}) {
    if (
      !Buffer.isBuffer(key) ||
      key.length !== 32 ||
      [environmentBinding, documentBinding, modelBinding].some(
        (x) => !hex.test(x),
      ) ||
      typeof ownershipMarker !== "string" ||
      !ownershipMarker ||
      ownershipMarker.length > 256
    )
      throw new Error("INTENT_CONFIG");
    this.#directory = privateDirectory(directory, { create: true });
    this.#key = Buffer.from(key);
    this.#bindings = {
      environment_binding: environmentBinding,
      document_binding: documentBinding,
      model_binding: modelBinding,
      ownership_digest: digest(ownershipMarker),
    };
  }
  async prepare(
    { method, environmentBinding, documentBinding, requestDigest, operationId },
    signal,
  ) {
    if (this.#closed) throw new Error("INTENT_CLOSED");
    signal?.throwIfAborted();
    if (
      this.#bindings.environment_binding !== environmentBinding ||
      this.#bindings.document_binding !== documentBinding ||
      !hex.test(requestDigest) ||
      typeof operationId !== "string"
    )
      throw new Error("INTENT_BINDING");
    const intent = checkIntent({
      kind: "moonapi-execution-intent",
      format: 1,
      id: randomUUID(),
      created_at: Date.now(),
      method,
      ...this.#bindings,
      request_digest: requestDigest,
      operation_digest: digest(operationId),
      automatic_replay_permitted: false,
    });
    saveEncryptedWitness(
      path.join(this.#directory, intent.id + ".intent.json"),
      intent,
      this.#key,
    );
    signal?.throwIfAborted();
    return { id: intent.id, durable: true, automatic_replay_permitted: false };
  }
  inspect(id) {
    if (this.#closed) throw new Error("INTENT_CLOSED");
    if (!idPattern.test(id)) throw new Error("INTENT_ID");
    const intent = checkIntent(
      loadEncryptedWitness(
        path.join(this.#directory, id + ".intent.json"),
        this.#key,
      ),
    );
    if (
      intent.id !== id ||
      fields.slice(0, 4).some((k) => intent[k] !== this.#bindings[k])
    )
      throw new Error("INTENT_BINDING");
    return intent;
  }
  // The adapter is caller-trusted code and must implement an authoritative,
  // read-only receipt lookup. An arbitrary API 404 is never authoritative.
  async reconcile(id, adapter, { timeout = 2000 } = {}) {
    if (
      !adapter ||
      adapter.version !== 1 ||
      typeof adapter.inspect !== "function" ||
      !Number.isInteger(timeout) ||
      timeout < 10 ||
      timeout > 30000
    )
      throw new Error("INTENT_RECONCILER");
    const intent = this.inspect(id),
      signal = AbortSignal.timeout(timeout);
    const receipt = await within(
      signal,
      () => adapter.inspect(Object.freeze({ ...intent }), signal),
      "INTENT_RECONCILE_DEADLINE",
    );
    let state = "still_unknown";
    if (
      receipt?.request_digest === intent.request_digest &&
      receipt?.environment_binding === intent.environment_binding
    ) {
      if (receipt.state === "committed") state = "observed_committed";
      if (receipt.state === "not_committed" && receipt.authoritative === true)
        state = "authoritatively_not_committed";
    }
    const disposition = {
      kind: "moonapi-intent-disposition",
      format: 1,
      intent_id: id,
      state,
      receipt_id: randomUUID(),
      automatic_replay_permitted: false,
      authority:
        "caller-trusted read-only adapter; not independently certified",
    };
    saveEncryptedWitness(
      path.join(this.#directory, disposition.receipt_id + ".disposition.json"),
      disposition,
      this.#key,
    );
    return disposition;
  }
  close() {
    this.#closed = true;
    this.#key.fill(0);
  }
}
export const intentEnvironmentBinding = (base) => {
  const url = new URL(base);
  if (url.username || url.password || url.search || url.hash)
    throw new Error("INTENT_BASE");
  return digest(url.href.replace(/\/$/, ""));
};
export const intentRequestDigest = (method, target, request) =>
  digest(
    JSON.stringify({
      method,
      target: target.href,
      body: request.body?.toString("base64") ?? null,
      // Never persist bearer/API credentials, even encrypted. The digest commits
      // to payload/target/media; it is NOT an authentication or identity proof.
      media: request.headers["content-type"] ?? null,
    }),
  );

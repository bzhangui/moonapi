import fs from "node:fs";
import path from "node:path";
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { performance } from "node:perf_hooks";
import { loadCore } from "./runner.mjs";
import { privateDirectory, readPrivate } from "./private-store.mjs";
const methods = new Set([
  "GET",
  "HEAD",
  "OPTIONS",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "TRACE",
]);
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function journalSettings(options = {}) {
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    Reflect.ownKeys(options).some(
      (k) => !["authKey", "segmentBytes", "maxBytes"].includes(k),
    )
  )
    throw new Error("LEDGER_OPTIONS");
  return options;
}
function transition(from, to) {
  const r = JSON.parse(
    globalThis.__moonapi_core(
      JSON.stringify({ action: "execution-transition", from, to }),
    ),
  );
  if (!r.ok) throw new Error("LEDGER_TRANSITION");
  return r.value;
}
export class ExecutionLedger {
  #fd;
  #events = [];
  #states = new Map();
  #start = performance.now();
  #closed = false;
  #bytes = 0;
  #maxBytes;
  #key;
  #segmentBytes;
  #segmentSize = 0;
  #segment = 0;
  #root;
  static async open({
    directory,
    runId = randomUUID(),
    maxBytes = 8388608,
    authKey,
    segmentBytes = 8388608,
  } = {}) {
    await loadCore();
    if (!/^[a-zA-Z0-9_-]{1,96}$/.test(runId)) throw new Error("LEDGER_RUN_ID");
    const ledger = new ExecutionLedger();
    if (!Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > 8388608)
      throw new Error("LEDGER_RESOURCE_BUDGET");
    ledger.#maxBytes = maxBytes;
    if (
      (authKey !== undefined &&
        (!Buffer.isBuffer(authKey) || authKey.length !== 32)) ||
      !Number.isInteger(segmentBytes) ||
      segmentBytes < 1024 ||
      segmentBytes > 8388608
    )
      throw new Error("LEDGER_AUTH_OR_SEGMENT");
    ledger.#key = authKey && Buffer.from(authKey);
    ledger.#segmentBytes = segmentBytes;
    ledger.runId = runId;
    if (directory) {
      const root = privateDirectory(directory, { create: true });
      ledger.file = path.join(root, runId + ".jsonl");
      ledger.#root = root;
      ledger.#fd = fs.openSync(ledger.file, "wx", 0o600);
    }
    return ledger;
  }
  event(attempt, state, { method, operation_id, step_id, status } = {}) {
    if (this.#closed) throw new Error("LEDGER_CLOSED");
    if (
      !Number.isInteger(attempt) ||
      attempt < 1 ||
      attempt > 10000 ||
      !methods.has(method) ||
      !Number.isInteger(status ?? 0) ||
      (status ?? 0) < 0 ||
      (status ?? 0) > 599
    )
      throw new Error("LEDGER_EVENT");
    const previousState = this.#states.get(attempt) || "";
    transition(previousState, state);
    const alias = (value) =>
      hash([this.runId, String(value ?? "")]).slice(0, 20);
    const entry = {
      format: this.#key ? 2 : 1,
      run_id: this.runId,
      seq: this.#events.length + 1,
      attempt,
      state,
      method,
      operation_alias: alias(operation_id),
      step_alias: alias(step_id),
      status: status ?? 0,
      elapsed_ms: Math.max(0, Math.floor(performance.now() - this.#start)),
      previous: this.#events.at(-1)?.hash || "0".repeat(64),
    };
    entry.hash = hash(entry);
    if (this.#key)
      entry.mac = createHmac("sha256", this.#key)
        .update("MoonAPI ledger v2\0" + entry.hash)
        .digest("hex");
    const bytes = Buffer.from(JSON.stringify(entry) + "\n");
    if (this.#bytes + bytes.length > this.#maxBytes)
      throw new Error("LEDGER_RESOURCE_BUDGET");
    if (this.#fd !== undefined) {
      try {
        if (
          this.#segmentSize &&
          this.#segmentSize + bytes.length > this.#segmentBytes
        ) {
          fs.closeSync(this.#fd);
          this.#fd = undefined;
          const next = path.join(
            this.#root,
            this.runId +
              "." +
              String(++this.#segment).padStart(4, "0") +
              ".jsonl",
          );
          this.#fd = fs.openSync(next, "wx", 0o600);
          this.#segmentSize = 0;
        }
        let offset = 0;
        while (offset < bytes.length) {
          const n = fs.writeSync(this.#fd, bytes, offset);
          if (!n) throw new Error("LEDGER_WRITE");
          offset += n;
        }
        fs.fsyncSync(this.#fd);
        this.#segmentSize += bytes.length;
      } catch (error) {
        // A failed rotation/write/fsync must poison this writer. It may never
        // silently continue as an in-memory-only ledger after durable I/O fails.
        this.close();
        throw error;
      }
    }
    this.#bytes += bytes.length;
    this.#events.push(entry);
    this.#states.set(attempt, state);
    return entry;
  }
  summary() {
    return {
      ...summarize(this.#events),
      final_hash: this.#events.at(-1)?.hash || "0".repeat(64),
    };
  }
  close() {
    if (this.#closed) return;
    this.#closed = true;
    try {
      if (this.#fd !== undefined) fs.closeSync(this.#fd);
    } finally {
      this.#fd = undefined;
      this.#key?.fill(0);
    }
  }
}
function summarize(events) {
  const attempts = new Map();
  for (const e of events) {
    const a = attempts.get(e.attempt) || {
      attempt: e.attempt,
      method: e.method,
      dispatched: false,
      sent: false,
      responded: false,
    };
    a.state = e.state;
    a.dispatched ||= e.state === "dispatching";
    a.sent ||= e.state === "sent";
    a.responded ||= e.state === "responded";
    attempts.set(e.attempt, a);
  }
  const rows = [...attempts.values()].map((a) => ({
    ...a,
    outcome: ["dispatching", "sent", "responded", "unknown"].includes(a.state)
      ? "unknown"
      : a.state,
  }));
  return {
    attempts: rows.length,
    dispatched: rows.filter((a) => a.dispatched).length,
    sent: rows.filter((a) => a.sent).length,
    responses: rows.filter((a) => a.responded).length,
    unknown: rows.filter((a) => a.outcome === "unknown").length,
    unknown_writes: rows.filter(
      (a) =>
        a.outcome === "unknown" &&
        !["GET", "HEAD", "OPTIONS"].includes(a.method),
    ).length,
    automatic_replay_permitted: false,
    receipts: rows,
  };
}
export async function recoverLedger(file, { authKey, expectedFinalHash } = {}) {
  return recoverText(readPrivate(file, 8388608), {
    authKey,
    expectedFinalHash,
  });
}
export async function recoverSegmentedLedger(directory, runId, options = {}) {
  if (!/^[a-zA-Z0-9_-]{1,96}$/.test(runId)) throw new Error("LEDGER_RUN_ID");
  const root = privateDirectory(directory);
  const names = fs
    .readdirSync(root)
    .filter(
      (n) =>
        n === runId + ".jsonl" ||
        (n.startsWith(runId + ".") && n.endsWith(".jsonl")),
    )
    .sort((a, b) => {
      if (a === runId + ".jsonl") return -1;
      if (b === runId + ".jsonl") return 1;
      return a.localeCompare(b);
    });
  if (!names.length || names.length > 8192) throw new Error("LEDGER_SEGMENTS");
  let text = "",
    bytes = 0;
  for (let i = 0; i < names.length; i++) {
    const expected =
      runId + (i ? "." + String(i).padStart(4, "0") : "") + ".jsonl";
    if (names[i] !== expected) throw new Error("LEDGER_SEGMENTS");
    const part = readPrivate(path.join(root, names[i]), 8388608);
    if ((bytes += Buffer.byteLength(part)) > 8388608)
      throw new Error("LEDGER_RESOURCE_BUDGET");
    if (i < names.length - 1 && (!part || !part.endsWith("\n")))
      throw new Error("LEDGER_CORRUPT");
    text += part;
  }
  return { ...(await recoverText(text, options)), segments: names.length };
}
async function recoverText(raw, { authKey, expectedFinalHash } = {}) {
  await loadCore();
  if (
    (authKey !== undefined &&
      (!Buffer.isBuffer(authKey) || authKey.length !== 32)) ||
    (expectedFinalHash !== undefined &&
      !/^[0-9a-f]{64}$/.test(expectedFinalHash))
  )
    throw new Error("LEDGER_AUTH_OR_CHECKPOINT");
  const lines = raw.split("\n"),
    torn = lines.at(-1) !== "";
  lines.pop();
  const entries = [],
    states = new Map(),
    identities = new Map();
  let previous = "0".repeat(64),
    run,
    format;
  for (const line of lines) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      throw new Error("LEDGER_CORRUPT");
    }
    if (!e || typeof e !== "object" || Array.isArray(e))
      throw new Error("LEDGER_CORRUPT");
    const { hash: actual, mac, ...data } = e;
    const authenticated = e.format === 2;
    if (Object.hasOwn(e, "mac") !== authenticated)
      throw new Error("LEDGER_CORRUPT");
    if (authenticated !== (authKey !== undefined))
      throw new Error("LEDGER_AUTH_REQUIRED_OR_FORMAT");
    if (
      authenticated &&
      (typeof mac !== "string" ||
        !/^[0-9a-f]{64}$/.test(mac) ||
        !timingSafeEqual(
          Buffer.from(mac, "hex"),
          createHmac("sha256", authKey)
            .update("MoonAPI ledger v2\0" + actual)
            .digest(),
        ))
    )
      throw new Error("LEDGER_AUTHENTICATION");
    if (
      Object.keys({ ...data, hash: actual })
        .sort()
        .join(",") !==
        "attempt,elapsed_ms,format,hash,method,operation_alias,previous,run_id,seq,state,status,step_alias" ||
      ![1, 2].includes(e.format) ||
      (format !== undefined && e.format !== format) ||
      e.seq !== entries.length + 1 ||
      e.previous !== previous ||
      hash(data) !== actual ||
      (run !== undefined && run !== e.run_id) ||
      typeof e.run_id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,96}$/.test(e.run_id) ||
      !methods.has(e.method) ||
      !Number.isInteger(e.attempt) ||
      e.attempt < 1 ||
      e.attempt > 10000 ||
      !Number.isInteger(e.status) ||
      e.status < 0 ||
      e.status > 599 ||
      !Number.isSafeInteger(e.elapsed_ms) ||
      e.elapsed_ms < 0 ||
      e.elapsed_ms < (entries.at(-1)?.elapsed_ms ?? 0) ||
      !/^([0-9a-f]{20})$/.test(e.operation_alias) ||
      !/^([0-9a-f]{20})$/.test(e.step_alias)
    )
      throw new Error("LEDGER_CORRUPT");
    const previousAttempt = identities.get(e.attempt);
    if (
      previousAttempt &&
      ["method", "operation_alias", "step_alias"].some(
        (k) => previousAttempt[k] !== e[k],
      )
    )
      throw new Error("LEDGER_CORRUPT");
    transition(states.get(e.attempt) || "", e.state);
    states.set(e.attempt, e.state);
    identities.set(e.attempt, e);
    entries.push(e);
    previous = actual;
    run = e.run_id;
    format = e.format;
  }
  if (expectedFinalHash !== undefined && previous !== expectedFinalHash)
    throw new Error("LEDGER_CHECKPOINT_MISMATCH");
  return {
    ...summarize(entries),
    torn_tail: torn,
    final_hash: previous,
    integrity: authKey
      ? "hmac-sha256; shared-key authentication, not a public signature"
      : "hash-chain; not a signature",
    truncation_detection:
      expectedFinalHash !== undefined
        ? "external checkpoint matched"
        : "whole-record suffix deletion is not detectable without an external checkpoint",
    recovery: "inspect-only; never replays requests",
  };
}

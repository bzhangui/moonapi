import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
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
  static async open({ directory, runId = randomUUID() } = {}) {
    await loadCore();
    if (!/^[a-zA-Z0-9_-]{1,96}$/.test(runId)) throw new Error("LEDGER_RUN_ID");
    const ledger = new ExecutionLedger();
    ledger.runId = runId;
    if (directory) {
      const root = privateDirectory(directory, { create: true });
      ledger.file = path.join(root, runId + ".jsonl");
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
      format: 1,
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
    if (this.#fd !== undefined) {
      const bytes = Buffer.from(JSON.stringify(entry) + "\n");
      let offset = 0;
      while (offset < bytes.length) {
        const n = fs.writeSync(this.#fd, bytes, offset);
        if (!n) throw new Error("LEDGER_WRITE");
        offset += n;
      }
      fs.fsyncSync(this.#fd);
    }
    this.#events.push(entry);
    this.#states.set(attempt, state);
    return entry;
  }
  summary() {
    return summarize(this.#events);
  }
  close() {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#fd !== undefined) fs.closeSync(this.#fd);
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
export async function recoverLedger(file) {
  await loadCore();
  const raw = readPrivate(file, 8388608),
    lines = raw.split("\n"),
    torn = lines.at(-1) !== "";
  lines.pop();
  const entries = [],
    states = new Map();
  let previous = "0".repeat(64),
    run;
  for (const line of lines) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      throw new Error("LEDGER_CORRUPT");
    }
    const { hash: actual, ...data } = e;
    if (
      Object.keys(e).sort().join(",") !==
        "attempt,elapsed_ms,format,hash,method,operation_alias,previous,run_id,seq,state,status,step_alias" ||
      e.format !== 1 ||
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
    const previousAttempt = entries.find((x) => x.attempt === e.attempt);
    if (
      previousAttempt &&
      ["method", "operation_alias", "step_alias"].some(
        (k) => previousAttempt[k] !== e[k],
      )
    )
      throw new Error("LEDGER_CORRUPT");
    transition(states.get(e.attempt) || "", e.state);
    states.set(e.attempt, e.state);
    entries.push(e);
    previous = actual;
    run = e.run_id;
  }
  return {
    ...summarize(entries),
    torn_tail: torn,
    integrity: "hash-chain; not a signature",
    recovery: "inspect-only; never replays requests",
  };
}

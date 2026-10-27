import { performance } from "node:perf_hooks";
import { cloneExact, equal } from "./standard-value.mjs";
import { pointer } from "./standard-expression.mjs";
import { within } from "./adapters.mjs";
export class IsolationLease {
  #adapter;
  #lease;
  #deadline;
  #released = false;
  static async acquire(adapter, signal) {
    if (
      !adapter ||
      adapter.version !== 1 ||
      typeof adapter.acquire !== "function" ||
      typeof adapter.verify !== "function" ||
      typeof adapter.release !== "function"
    )
      throw new Error("ISOLATION_ADAPTER");
    const lease = new IsolationLease();
    lease.#adapter = adapter;
    lease.#lease = await within(
      signal,
      () => adapter.acquire(signal),
      "ISOLATION_DEADLINE",
    );
    try {
      if (
        !lease.#lease ||
        !Number.isInteger(lease.#lease.ttlMs) ||
        lease.#lease.ttlMs < 100 ||
        lease.#lease.ttlMs > 600000
      )
        throw new Error("ISOLATION_LEASE");
      lease.#deadline = performance.now() + lease.#lease.ttlMs;
      if (
        (await within(
          signal,
          () => adapter.verify(lease.#lease, signal),
          "ISOLATION_DEADLINE",
        )) !== true
      )
        throw new Error("ISOLATION_UNCONFIRMED");
    } catch {
      try {
        await lease.release();
      } catch {}
      throw new Error("ISOLATION_UNCONFIRMED");
    }
    return lease;
  }
  async verify(signal) {
    if (this.#released || performance.now() >= this.#deadline)
      throw new Error("ISOLATION_EXPIRED");
    if (
      (await within(
        signal,
        () => this.#adapter.verify(this.#lease, signal),
        "ISOLATION_DEADLINE",
      )) !== true
    )
      throw new Error("ISOLATION_LOST");
  }
  async release() {
    if (this.#released) return true;
    this.#released = true;
    return (
      (await within(
        AbortSignal.timeout(2000),
        () => this.#adapter.release(this.#lease),
        "ISOLATION_RELEASE_DEADLINE",
      )) === true
    );
  }
}
// Bounded observational probe only. Even a 404 cannot prove that a lost write
// did not commit in an eventually consistent system, so replay remains denied.
export async function inspectUnknown(
  engine,
  base,
  request,
  { committed, absent } = {},
) {
  const op = engine.description.operations.find(
    (o) => o.id === request.operation_id,
  );
  if (!op || !["GET", "HEAD", "OPTIONS"].includes(op.method))
    throw new Error("OUTCOME_READ_ONLY");
  const result = await engine.execute(base, cloneExact(request), {
    expectedStatuses: [200, 202, 204, 404, 410],
  });
  const matches = (condition) =>
    condition &&
    result.context &&
    Object.hasOwn(condition, "value") &&
    equal(
      pointer(result.context.response.body, condition.pointer),
      condition.value,
    );
  const state = result.record?.passed
    ? matches(committed)
      ? "observed_committed"
      : matches(absent)
        ? "observed_absent"
        : "still_unknown"
    : "still_unknown";
  return {
    state,
    status: result.record?.status || 0,
    automatic_replay_permitted: false,
    observation_only: true,
  };
}

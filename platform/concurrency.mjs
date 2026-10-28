import { StandardEngine } from "./standard.mjs";
import { portable } from "./workflow.mjs";
import { cloneExact } from "./standard-value.mjs";
import { pointer } from "./standard-expression.mjs";
import { Engine } from "./runner.mjs";
import { ExecutionLedger, journalSettings } from "./execution-ledger.mjs";
export async function concurrentRegisterProbe(
  source,
  base,
  calls,
  { initial = 0, engineOptions = {}, resultPointer = "/value" } = {},
) {
  if (!Array.isArray(calls) || !calls.length || calls.length > 8)
    throw new Error("CONCURRENCY_BUDGET");
  const integer = (v) =>
    Number.isSafeInteger(v) && v >= -1000000 && v <= 1000000;
  if (
    !integer(initial) ||
    typeof resultPointer !== "string" ||
    !resultPointer.startsWith("/")
  )
    throw new Error("CONCURRENCY_MODEL");
  for (const call of calls)
    if (
      !["read", "write", "cas"].includes(call.kind) ||
      !call.request ||
      (["write", "cas"].includes(call.kind) && !integer(call.value)) ||
      (call.kind === "cas" && !integer(call.expected))
    )
      throw new Error("CONCURRENCY_MODEL");
  const engines = [];
  let clock = 0;
  try {
    for (const _ of calls)
      engines.push(await StandardEngine.open(source, engineOptions));
    new Engine("{}", { allowRemote: engineOptions.allowRemote === true }).base(
      base,
    );
    for (let i = 0; i < calls.length; i++) {
      const op = engines[i].description.operations.find(
        (o) => o.id === calls[i].request.operation_id,
      );
      if (
        !op ||
        (!["GET", "HEAD", "OPTIONS"].includes(op.method) &&
          engineOptions.allowWrite !== true) ||
        op.callbacks.length
      )
        throw new Error("CONCURRENCY_PERMISSION");
      if (!(await engines[i].validateRequest(calls[i].request)).valid)
        throw new Error("CONCURRENCY_REQUEST");
    }
    const history = await Promise.all(
      calls.map(async (call, index) => {
        if (!["read", "write", "cas"].includes(call.kind))
          throw new Error("CONCURRENCY_KIND");
        const start = ++clock,
          result = await engines[index].execute(
            base,
            cloneExact(call.request),
            { expectedStatuses: [200, 201, 204, 409, 412] },
          );
        const end = ++clock;
        if (!result.record?.passed || !result.context)
          throw new Error("CONCURRENCY_INCONCLUSIVE");
        const observed = pointer(result.context.response.body, resultPointer);
        if (!Number.isSafeInteger(observed))
          throw new Error("CONCURRENCY_REGISTER_INTEGER");
        return {
          kind: call.kind,
          expected: call.expected ?? 0,
          value: call.value ?? 0,
          observed,
          success: result.context.status < 400,
          start,
          end,
        };
      }),
    );
    const verdict = portable("register-history", { initial, history });
    return {
      ...verdict,
      passed: verdict.linearizable,
      concurrent_operations: calls.length,
      controlled_probe: true,
      real_user_validation: false,
    };
  } finally {
    await Promise.all(engines.map((e) => e.close()));
  }
}

// Bounded counter/reservation sequential specifications are implemented in
// MoonBit. Success/failure and returned balance are checked, not merely sums.
export async function concurrentResourceProbe(
  source,
  base,
  calls,
  {
    model = "reservation",
    initial = 1,
    capacity = 1,
    resultPointer = "/value",
    engineOptions = {},
    journalDirectory,
    journalOptions,
  } = {},
) {
  if (
    !["reservation", "counter"].includes(model) ||
    !Number.isInteger(initial) ||
    !Number.isInteger(capacity) ||
    initial < 0 ||
    initial > capacity ||
    capacity > 1000000 ||
    !Array.isArray(calls) ||
    !calls.length ||
    calls.length > 8 ||
    typeof resultPointer !== "string" ||
    !resultPointer.startsWith("/")
  )
    throw new Error("CONCURRENCY_MODEL");
  for (const call of calls)
    if (
      !(
        model === "counter" ? ["read", "add"] : ["read", "reserve", "release"]
      ).includes(call.kind) ||
      !Number.isInteger(call.amount ?? 0) ||
      Math.abs(call.amount ?? 0) > 1000000 ||
      (model === "reservation" && call.kind !== "read" && !(call.amount > 0)) ||
      !call.request
    )
      throw new Error("CONCURRENCY_MODEL");
  const engines = [];
  let clock = 0,
    ledger;
  try {
    for (const call of calls) {
      const engine = await StandardEngine.open(source, engineOptions);
      engines.push(engine);
      const op = engine.description.operations.find(
        (o) => o.id === call.request.operation_id,
      );
      if (
        !op ||
        op.callbacks.length ||
        (!["GET", "HEAD", "OPTIONS"].includes(op.method) &&
          engineOptions.allowWrite !== true)
      )
        throw new Error("CONCURRENCY_PERMISSION");
      if (!(await engine.validateRequest(call.request)).valid)
        throw new Error("CONCURRENCY_REQUEST");
    }
    new Engine("{}", { allowRemote: engineOptions.allowRemote === true }).base(
      base,
    );
    ledger = await ExecutionLedger.open({
      ...journalSettings(journalOptions),
      directory: journalDirectory,
    });
    const settled = await Promise.allSettled(
      calls.map(async (call, i) => {
        const start = ++clock,
          result = await engines[i].execute(base, cloneExact(call.request), {
            expectedStatuses: [200, 201, 409, 412],
            onEvent: (e) => ledger.event(i + 1, e.state, e),
          }),
          end = ++clock;
        if (!result.record?.passed || !result.context)
          throw new Error("CONCURRENCY_INCONCLUSIVE");
        const observed = pointer(result.context.response.body, resultPointer);
        if (!Number.isSafeInteger(observed))
          throw new Error("CONCURRENCY_INTEGER");
        return {
          kind: call.kind,
          amount: call.amount ?? 0,
          observed,
          success: result.context.status < 400,
          start,
          end,
        };
      }),
    );
    if (settled.some((r) => r.status !== "fulfilled"))
      return {
        passed: false,
        inconclusive: true,
        execution: ledger.summary(),
        general_api_proof: false,
        automatic_replay_permitted: false,
      };
    const history = settled.map((r) => r.value);
    const verdict = portable("resource-history", {
      model,
      initial,
      capacity,
      history,
    });
    return {
      ...verdict,
      passed: verdict.linearizable,
      controlled_probe: true,
      real_user_validation: false,
      consistency_model:
        "bounded linearizability of a declared sequential resource model",
    };
  } finally {
    ledger?.close();
    await Promise.all(engines.map((e) => e.close()));
  }
}

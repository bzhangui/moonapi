// Network-neutral decisions are in MoonBit; this adapter owns HTTP and reset I/O.
import { Engine, VERSION } from "./runner.mjs";

const own = (value, keys) => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).some((k) => !keys.includes(k))
  )
    throw new Error("Unsupported behavior options");
};
const legacyStep = (step) =>
  Object.fromEntries(
    Object.entries(step).filter(([k]) =>
      [
        "operationId",
        "parameters",
        "body",
        "negative",
        "status",
        "capture",
      ].includes(k),
    ),
  );
function exactJson(value, depth = 0, counter = { nodes: 0 }) {
  if (depth > 40 || ++counter.nodes > 10000)
    throw new Error("Behavior JSON budget");
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number") {
    if (
      !Number.isFinite(value) ||
      (Number.isInteger(value) && !Number.isSafeInteger(value))
    )
      throw new Error("Behavior numbers must be finite and integers exact");
    return;
  }
  if (
    !value ||
    typeof value !== "object" ||
    (!Array.isArray(value) &&
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
  )
    throw new Error(
      "Behavior requires JSON data without implicit serialization",
    );
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") continue;
    if (
      Array.isArray(value) &&
      (!/^(0|[1-9][0-9]*)$/.test(String(key)) || Number(key) >= value.length)
    )
      throw new Error("Behavior arrays cannot have extra properties");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== "string" ||
      descriptor.get ||
      descriptor.set ||
      !descriptor.enumerable
    )
      throw new Error("Behavior requires plain JSON properties");
    exactJson(descriptor.value, depth + 1, counter);
  }
  if (
    Array.isArray(value) &&
    (value.length > 10000 || Object.keys(value).length !== value.length)
  )
    throw new Error("Sparse or oversized behavior arrays unsupported");
}

export class BehaviorEngine {
  constructor(source, options = {}) {
    this.engine = new Engine(source, options);
  }
  plan(model, { steps = 32, checkPermissions = false } = {}) {
    if (
      !model ||
      typeof model !== "object" ||
      Array.isArray(model) ||
      !Number.isInteger(steps) ||
      steps < 1 ||
      steps > 64
    )
      throw new Error("Invalid model or step budget");
    exactJson(model);
    if (Buffer.byteLength(JSON.stringify(model)) > 65536)
      throw new Error("Behavior model exceeds 64 KiB");
    const generated = Object.hasOwn(model, "transitions")
      ? this.engine.command("sequence-generate", {
          model,
          seed: this.engine.options.seed,
          limit: steps,
        })
      : { trace: structuredClone(model), generation_reason: "explicit_trace" };
    this.engine.command("sequence-check", { model: generated.trace });
    const operations = new Map(
      this.engine
        .command("plan", { limit: 1 })
        .operations.map((o) => [o.id, o]),
    );
    // Whole chosen plan permissions are checked before even the reset hook runs.
    for (const step of model.transitions ?? generated.trace.steps) {
      const op = operations.get(step.operationId);
      if (!op) throw new Error("Unknown behavior operation");
      if (checkPermissions && !this.engine.permitted({ verb: op.verb }))
        throw new Error("Behavior writes require allowWrite");
      if (Object.hasOwn(step, "body") && op.request === null)
        throw new Error("Behavior body specified for bodyless operation");
      if (
        step.parameters &&
        Object.keys(step.parameters).some(
          (k) => !op.parameters.some((p) => p.name === k),
        )
      )
        throw new Error("Undeclared behavior parameter");
    }
    return generated;
  }
  async run(base, model, options = {}) {
    own(options, ["reset", "allowReset", "saveRepro", "steps"]);
    const {
      reset,
      allowReset = false,
      saveRepro = false,
      steps = 32,
    } = options;
    if (
      typeof allowReset !== "boolean" ||
      typeof saveRepro !== "boolean" ||
      !allowReset ||
      typeof reset !== "function"
    )
      throw new Error(
        "An explicitly authorized isolated reset hook is required",
      );
    this.engine.base(base);
    const generated = this.plan(model, { steps, checkPermissions: true }),
      original = generated.trace;
    const deadline = Date.now() + this.engine.options.totalTimeout;
    let resets = 0,
      attempts = 0;
    const resetEnvironment = async () => {
      const remaining = Math.min(
        this.engine.options.timeout,
        deadline - Date.now(),
      );
      if (remaining <= 0) throw new Error("Behavior total deadline");
      const controller = new AbortController();
      let timer;
      try {
        const confirmed = await Promise.race([
          Promise.resolve().then(() => reset({ signal: controller.signal })),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new Error("Reset deadline"));
            }, remaining);
          }),
        ]);
        if (confirmed !== true)
          throw new Error("Reset must explicitly confirm success");
        resets++;
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
    };
    const replay = async (trace) => {
      this.engine.command("sequence-check", { model: trace });
      await resetEnvironment();
      let bindings = structuredClone(trace.initial);
      const results = [];
      try {
        for (const step of trace.steps) {
          if (Date.now() >= deadline)
            throw new Error("Behavior total deadline");
          if (
            !this.engine.command("model-preconditions", { step, bindings })
              .enabled
          )
            throw new Error("Model precondition refused");
          const test = this.engine.command("scenario", {
            step: legacyStep(step),
            bindings,
          }).case;
          // Resolve predicate operand types before any request, so a malformed
          // model is not reported as a reproducible defect in the target service.
          this.engine.command("model-assert", { step, body: null, bindings });
          const seen = await this.engine.observe(base, test, deadline);
          let finding = seen.finding;
          if (!finding.passed)
            finding = {
              ...finding,
              fingerprint: step.id + ":contract:" + finding.fingerprint,
            };
          else
            finding = this.engine.command("model-assert", {
              step,
              body: seen.body,
              bindings,
            }).finding;
          results.push({
            step: step.id,
            operation: step.operationId,
            status: seen.status,
            passed: finding.passed,
            fingerprint: finding.fingerprint,
            issues: finding.issues,
          });
          if (!finding.passed)
            return {
              results,
              failure: { step: step.id, status: seen.status, ...finding },
            };
          bindings = this.engine.command("capture", {
            step: legacyStep(step),
            body: seen.body,
            bindings,
          }).bindings;
          bindings = this.engine.command("model-effects", {
            step,
            bindings,
          }).bindings;
        }
        return { results, failure: null };
      } catch {
        return {
          results,
          failure: null,
          error: "binding_capture_or_execution_error",
        };
      }
    };
    let first;
    try {
      first = await replay(original);
    } catch {
      return {
        format: 2,
        tool: "MoonAPI",
        version: VERSION,
        mode: "stateful_behavior",
        complete: false,
        stop_reason: "reset_or_execution_error",
        planned: original.steps.length,
        executed: 0,
        failed: 0,
        reset_count: resets,
        property_failure_confirmed: false,
        real_user_pilot: false,
      };
    }
    let best = original,
      bestResult = first,
      stable = false,
      reason = first.error
        ? "incomplete"
        : first.failure
          ? "not_replayed"
          : "passed";
    const writable = original.steps.some(
      (s) =>
        !["GET", "HEAD", "OPTIONS"].includes(
          this.engine.command("scenario", {
            step: { operationId: s.operationId },
            bindings: {},
          }).case.verb,
        ),
    );
    // Do not replay transport/auth/rate failures or repeat mutations without consent.
    const unsuitable =
      first.failure &&
      (first.failure.status === 0 ||
        [401, 403, 429].includes(first.failure.status));
    if (
      first.failure &&
      !unsuitable &&
      (!writable || this.engine.options.shrinkWrite)
    ) {
      try {
        const confirmation = await replay(original);
        if (confirmation.error) throw new Error("Replay incomplete");
        stable =
          confirmation.failure?.fingerprint === first.failure.fingerprint;
        reason = stable ? "budget_or_local_minimum" : "unstable_failure";
        let improved = stable;
        while (
          improved &&
          attempts < this.engine.options.shrinkBudget &&
          Date.now() < deadline
        ) {
          improved = false;
          for (const candidate of this.engine.command("sequence-candidates", {
            model: best,
          }).candidates) {
            if (
              attempts >= this.engine.options.shrinkBudget ||
              Date.now() >= deadline
            )
              break;
            attempts++;
            const result = await replay(candidate);
            if (result.error) throw new Error("Replay incomplete");
            if (result.failure?.fingerprint === first.failure.fingerprint) {
              best = candidate;
              bestResult = result;
              improved = true;
              break;
            }
          }
        }
        if (stable) {
          // Final witness is independently replayed, not just a speculative candidate.
          const final = await replay(best);
          if (final.error) throw new Error("Final witness incomplete");
          if (final.failure?.fingerprint !== first.failure.fingerprint) {
            stable = false;
            reason = "unstable_final_witness";
          } else bestResult = final;
        }
      } catch {
        stable = false;
        reason = "replay_reset_or_deadline_error";
      }
    } else if (first.failure)
      reason = unsuitable
        ? "transport_or_access_failure"
        : "write_sequence_replay_not_authorized";
    const report = {
      format: 2,
      tool: "MoonAPI",
      version: VERSION,
      mode: "stateful_behavior",
      full_openapi_support: false,
      contract_profile: "moonapi-oas30-json-v1",
      seed: this.engine.options.seed,
      planned: original.steps.length,
      executed: first.results.length,
      failed: first.failure ? 1 : 0,
      complete:
        !first.failure &&
        !first.error &&
        first.results.length === original.steps.length,
      complete_meaning: "chosen_trace_only",
      model_coverage_complete:
        generated.total_transitions === undefined
          ? null
          : generated.covered_transitions.length ===
            generated.total_transitions,
      results: first.results,
      stop_reason: first.error
        ? "configuration_or_execution_error"
        : unsuitable
          ? "transport_or_access_failure"
          : first.failure
            ? "property_failure"
            : "completed",
      not_executed: original.steps.length - first.results.length,
      generation_reason: generated.generation_reason,
      covered_transitions: generated.covered_transitions,
      total_transitions: generated.total_transitions,
      original_steps: original.steps.length,
      minimized_steps: stable ? best.steps.length : original.steps.length,
      shrink_attempts: attempts,
      shrink_reason: reason,
      fingerprint: first.failure?.fingerprint || "",
      property_failure_confirmed: stable,
      reset_count: resets,
      reset_isolation: "caller_provided_hook",
      real_user_pilot: false,
    };
    if (saveRepro && stable)
      report.reproduction = {
        model: best,
        fingerprint: first.failure.fingerprint,
        verified_failure_step: bestResult.failure.step,
        requires_fresh_reset: true,
      };
    return report;
  }
}

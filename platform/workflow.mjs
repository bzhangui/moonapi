import { createHash } from "node:crypto";
import { StandardEngine } from "./standard.mjs";
import { Engine } from "./runner.mjs";
import { cloneExact, stringifyExact, equal } from "./standard-value.mjs";
import { expression, bindExpression } from "./standard-expression.mjs";
export function portable(action, args) {
  const result = JSON.parse(
    globalThis.__moonapi_core(JSON.stringify({ action, ...args })),
  );
  if (!result.ok) throw new Error("WORKFLOW_POLICY");
  return result.value;
}
const safe = /^[A-Za-z0-9_.-]{1,96}$/;
const allowedAssertions = [
  "equal",
  "not_equal",
  "exists",
  "absent",
  "status",
  "count",
];
function refCheck(ref, ids, current) {
  if (!ref || typeof ref !== "object" || Array.isArray(ref))
    throw new Error("WORKFLOW_REFERENCE");
  if (Object.hasOwn(ref, "value")) {
    if (Object.keys(ref).length !== 1) throw new Error("WORKFLOW_REFERENCE");
    return [];
  }
  if (
    Object.keys(ref).some((k) => !["from", "expression"].includes(k)) ||
    typeof ref.from !== "string" ||
    (!ids.has(ref.from) && ref.from !== current) ||
    typeof ref.expression !== "string"
  )
    throw new Error("WORKFLOW_REFERENCE");
  portable("standard-expression", { expression: ref.expression });
  return ref.from === current ? [] : [ref.from];
}
export function workflowModel(input, description) {
  const model = cloneExact(input);
  if (
    Buffer.byteLength(stringifyExact(model)) > 262144 ||
    model.version !== 1 ||
    Object.keys(model).some((k) => !["version", "steps"].includes(k)) ||
    !Array.isArray(model.steps) ||
    !model.steps.length ||
    model.steps.length > 64
  )
    throw new Error("WORKFLOW_MODEL");
  const ids = new Set();
  for (const step of model.steps) {
    if (
      typeof step.id !== "string" ||
      !safe.test(step.id) ||
      ids.has(step.id) ||
      Object.keys(step).some(
        (k) =>
          ![
            "id",
            "request",
            "bindings",
            "assertions",
            "requires",
            "effects",
            "poll",
            "expect",
          ].includes(k),
      )
    )
      throw new Error("WORKFLOW_STEP");
    const request = step.request,
      op = description.operations.find((o) => o.id === request?.operation_id);
    if (
      !op ||
      !Array.isArray(request.parameters) ||
      request.negative !== false ||
      Object.keys(request).some(
        (k) =>
          !["operation_id", "parameters", "negative", "body", "media"].includes(
            k,
          ),
      )
    )
      throw new Error("WORKFLOW_REQUEST");
    const needs = new Set();
    if (
      step.expect !== undefined &&
      (!Array.isArray(step.expect) ||
        !step.expect.length ||
        step.expect.length > 16 ||
        step.expect.some(
          (s) =>
            !Number.isInteger(s) ||
            s < 200 ||
            s >= 500 ||
            [401, 403, 429].includes(s),
        ))
    )
      throw new Error("WORKFLOW_EXPECT");
    for (const b of step.bindings || []) {
      if (Object.keys(b).sort().join(",") !== "expression,from,target")
        throw new Error("WORKFLOW_BINDING");
      for (const id of refCheck(
        { from: b.from, expression: b.expression },
        ids,
        undefined,
      ))
        needs.add(id);
      const ast = portable("standard-expression", { expression: b.target });
      if (
        ast.source !== "request" ||
        !["body", "path", "query", "header"].includes(ast.kind)
      )
        throw new Error("WORKFLOW_BINDING");
    }
    if (
      (step.assertions || []).length > 32 ||
      (step.bindings || []).length > 32
    )
      throw new Error("WORKFLOW_ASSERTION_BUDGET");
    const assertionIds = new Set();
    for (const a of step.assertions || []) {
      if (
        typeof a.id !== "string" ||
        !safe.test(a.id) ||
        assertionIds.has(a.id) ||
        !allowedAssertions.includes(a.kind) ||
        Object.keys(a).some((k) => !["id", "kind", "left", "right"].includes(k))
      )
        throw new Error("WORKFLOW_ASSERTION");
      assertionIds.add(a.id);
      for (const ref of [
        a.left,
        ...(["exists", "absent"].includes(a.kind) ? [] : [a.right]),
      ])
        for (const id of refCheck(ref, ids, step.id)) needs.add(id);
    }
    for (const k of ["requires", "effects"]) {
      step[k] ??= [];
      if (
        !Array.isArray(step[k]) ||
        step[k].length > 64 ||
        step[k].some((x) => !safe.test(x))
      )
        throw new Error("WORKFLOW_STATE");
    }
    if (step.poll) {
      if (
        !["GET", "HEAD", "OPTIONS"].includes(op.method) ||
        Object.keys(step.poll).some(
          (k) => !["attempts", "interval", "pendingStatuses"].includes(k),
        ) ||
        !Number.isInteger(step.poll.attempts) ||
        step.poll.attempts < 1 ||
        step.poll.attempts > 20 ||
        !Number.isInteger(step.poll.interval) ||
        step.poll.interval < 0 ||
        step.poll.interval > 1000 ||
        (step.poll.pendingStatuses || []).some(
          (x) => !Number.isInteger(x) || x < 200 || x > 499,
        )
      )
        throw new Error("WORKFLOW_POLL_POLICY");
    }
    step.needs = [...needs];
    ids.add(step.id);
  }
  portable("workflow-check", { steps: metadata(model.steps) });
  return model;
}
function metadata(steps) {
  return steps.map(({ id, needs, requires, effects }) => ({
    id,
    needs,
    requires,
    effects,
  }));
}
function reference(ref, contexts) {
  return Object.hasOwn(ref, "value")
    ? ref.value
    : expression(ref.expression, contexts.get(ref.from) || {});
}
function assertions(step, contexts) {
  for (const a of step.assertions || []) {
    const left = reference(a.left, contexts),
      right = a.right && reference(a.right, contexts);
    const observed =
      a.kind === "exists"
        ? left !== undefined
        : a.kind === "absent"
          ? left === undefined
          : a.kind === "count"
            ? Array.isArray(left) && equal(left.length, right)
            : left !== undefined &&
              right !== undefined &&
              (a.kind === "not_equal"
                ? !equal(left, right)
                : equal(left, right));
    const outcome = portable("workflow-assert", { kind: a.kind, observed });
    if (!outcome.passed) return { ...outcome, assertion_id: a.id };
  }
  return { passed: true, code: "" };
}
export class StandardWorkflow {
  #engine;
  #busy = false;
  #closed = false;
  #cancelReset;
  static async open(source, options = {}) {
    const workflow = new StandardWorkflow();
    workflow.#engine = await StandardEngine.open(source, options);
    return workflow;
  }
  get description() {
    return this.#engine.description;
  }
  close() {
    this.#closed = true;
    this.#cancelReset?.();
    return this.#engine.close();
  }
  async run(
    base,
    input,
    {
      reset,
      allowReset = false,
      shrink = false,
      shrinkBudget = 32,
      totalTimeout = 60000,
    } = {},
  ) {
    if (this.#closed) throw new Error("WORKFLOW_CLOSED");
    if (this.#busy) throw new Error("WORKFLOW_BUSY");
    if (
      !Number.isInteger(shrinkBudget) ||
      shrinkBudget < 0 ||
      shrinkBudget > 128 ||
      !Number.isInteger(totalTimeout) ||
      totalTimeout < 100 ||
      totalTimeout > 600000 ||
      typeof allowReset !== "boolean" ||
      typeof shrink !== "boolean"
    )
      throw new Error("WORKFLOW_OPTIONS");
    const model = workflowModel(input, this.description);
    new Engine("{}", { allowRemote: this.#engine.options.allowRemote }).base(
      base,
    );
    // Preflight every side effect before invoking even an authorized reset hook.
    for (const step of model.steps) {
      const op = this.description.operations.find(
        (o) => o.id === step.request.operation_id,
      );
      if (
        !["GET", "HEAD", "OPTIONS"].includes(op.method) &&
        !this.#engine.options.allowWrite
      )
        throw new Error("WORKFLOW_WRITE_NOT_AUTHORIZED");
      if (op.callbacks.length && !this.#engine.options.allowCallbacks)
        throw new Error("WORKFLOW_CALLBACK_NOT_AUTHORIZED");
    }
    if (
      (reset && !allowReset) ||
      (allowReset && typeof reset !== "function") ||
      (shrink && (!allowReset || typeof reset !== "function"))
    )
      throw new Error("WORKFLOW_RESET_NOT_AUTHORIZED");
    this.#busy = true;
    const deadline = Date.now() + totalTimeout;
    let attempts = 0;
    const run = async (steps) => {
      const contexts = new Map(),
        records = [];
      if (this.#closed)
        return { records, category: "blocked", code: "engine_closed" };
      if (Date.now() >= deadline)
        return { records, category: "budget", code: "total_deadline" };
      if (reset) {
        const controller = new AbortController();
        let timer;
        try {
          const ok = await Promise.race([
            Promise.resolve().then(() => reset(controller.signal)),
            new Promise((_, reject) => {
              this.#cancelReset = () => {
                controller.abort();
                reject(new Error("WORKFLOW_CLOSED"));
              };
              timer = setTimeout(
                () => {
                  controller.abort();
                  reject(new Error("WORKFLOW_RESET_TIMEOUT"));
                },
                Math.max(1, deadline - Date.now()),
              );
            }),
          ]);
          if (ok !== true)
            return { records, category: "blocked", code: "reset_unconfirmed" };
        } catch {
          return {
            records,
            category: Date.now() >= deadline ? "budget" : "blocked",
            code: "reset_failed",
          };
        } finally {
          clearTimeout(timer);
          controller.abort();
          this.#cancelReset = undefined;
        }
      }
      for (const step of steps) {
        if (this.#closed)
          return { records, category: "blocked", code: "engine_closed" };
        if (Date.now() >= deadline)
          return { records, category: "budget", code: "total_deadline" };
        const request = cloneExact(step.request);
        for (const binding of step.bindings || []) {
          const value = reference(binding, contexts);
          if (
            value === undefined ||
            !bindExpression(request, binding.target, cloneExact(value))
          )
            return { records, category: "blocked", code: "binding_missing" };
        }
        let result, outcome;
        const count = step.poll?.attempts || 1;
        for (let n = 0; n < count; n++) {
          try {
            result = await this.#engine.execute(base, request, {
              deadline,
              expectedStatuses: step.expect,
            });
          } catch {
            return {
              records,
              category: "blocked",
              code: "request_contract_or_policy",
            };
          }
          if (!result.record || !result.context)
            return {
              records,
              category: result.record?.category || "blocked",
              code:
                result.record?.code ||
                result.blockers[0]?.code ||
                "execution_blocked",
            };
          contexts.set(step.id, result.context);
          outcome = result.record.passed
            ? assertions(step, contexts)
            : { passed: false, code: result.record.code };
          if (outcome.passed || n === count - 1) break;
          // Poll only a successful read with an unmet business assertion or an
          // explicitly declared pending status. Never retry transport or writes.
          if (
            !result.record.passed &&
            !step.poll?.pendingStatuses?.includes(result.record.status)
          )
            break;
          if (Date.now() + step.poll.interval >= deadline)
            return { records, category: "budget", code: "total_deadline" };
          await new Promise((r) => setTimeout(r, step.poll.interval));
        }
        const code = outcome.code,
          category = portable("workflow-category", { code });
        records.push({
          step_id: step.id,
          operation_id: request.operation_id,
          status: result.record.status,
          code,
          category,
          passed: outcome.passed,
          assertion_id: outcome.assertion_id,
        });
        if (!outcome.passed) {
          const fingerprint = createHash("sha256")
            .update(
              [
                request.operation_id,
                step.id,
                result.record.status,
                code,
                outcome.assertion_id || "",
              ].join("\0"),
            )
            .digest("hex");
          return { records, category, code, fingerprint };
        }
      }
      return { records, category: "passed", code: "" };
    };
    try {
      const initial = await run(model.steps);
      let retained = model.steps,
        confirmed = false,
        unstable = false;
      if (shrink && initial.category === "defect") {
        const replay = await run(retained);
        if (replay.fingerprint !== initial.fingerprint) unstable = true;
        else {
          for (let i = 0; i < retained.length && attempts < shrinkBudget; ) {
            const ids = portable("workflow-remove", {
              steps: metadata(retained),
              removed: retained[i].id,
            }).retained;
            const candidate = retained.filter((s) => ids.includes(s.id));
            if (!candidate.length) {
              i++;
              continue;
            }
            attempts++;
            const result = await run(candidate);
            if (
              result.category === "defect" &&
              result.fingerprint === initial.fingerprint
            ) {
              retained = candidate;
              i = 0;
            } else i++;
            if (Date.now() >= deadline) break;
          }
          const final = await run(retained);
          confirmed =
            final.category === "defect" &&
            final.fingerprint === initial.fingerprint;
        }
      }
      return {
        format: 1,
        mode: "standard-workflow",
        ...initial,
        passed: initial.category === "passed",
        complete: initial.category === "passed",
        original_steps: model.steps.length,
        retained_step_ids: retained.map((s) => s.id),
        shrink_attempts: attempts,
        shrink_confirmed: confirmed,
        unstable,
        shrink_budget_exhausted:
          initial.category === "defect" &&
          !unstable &&
          attempts >= shrinkBudget &&
          shrink,
        minimality:
          "dependency-preserving local reduction; not globally minimal",
        real_user_validation: false,
      };
    } finally {
      this.#busy = false;
    }
  }
}

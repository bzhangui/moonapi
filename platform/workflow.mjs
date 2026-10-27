import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { ExecutionLedger } from "./execution-ledger.mjs";
import { saveEncryptedWitness, digestExact } from "./private-store.mjs";
import { pointer } from "./standard-expression.mjs";
import { documentDigest } from "./ci-tools.mjs";
import { IsolationLease } from "./isolation.mjs";
import { inputCandidates } from "./input-shrink.mjs";
import { StandardEngine } from "./standard.mjs";
import { Engine, VERSION } from "./runner.mjs";
import {
  cloneExact,
  stringifyExact,
  equal,
  numeric,
  decimal,
} from "./standard-value.mjs";
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
  "gt",
  "gte",
  "lt",
  "lte",
  "sum",
  "unique",
];
function checkRequest(request, description, method) {
  const op = description.operations.find((o) => o.id === request?.operation_id);
  if (
    !op ||
    (method && op.method !== method) ||
    !Array.isArray(request.parameters) ||
    request.parameters.length > 64 ||
    request.negative !== false ||
    Object.keys(request).some(
      (k) =>
        !["operation_id", "parameters", "negative", "body", "media"].includes(
          k,
        ),
    )
  )
    throw new Error("WORKFLOW_REQUEST");
  const seen = new Set();
  for (const p of request.parameters) {
    if (
      !p ||
      typeof p !== "object" ||
      Array.isArray(p) ||
      !["path", "query", "header", "cookie"].includes(p.in) ||
      typeof p.name !== "string" ||
      !p.name ||
      p.name.length > 256 ||
      !Object.hasOwn(p, "value") ||
      Object.keys(p).some((k) => !["in", "name", "value"].includes(k)) ||
      seen.has(p.in + ":" + p.name)
    )
      throw new Error("WORKFLOW_PARAMETER");
    seen.add(p.in + ":" + p.name);
  }
  return op;
}
function checkBindings(bindings, ids) {
  if (!Array.isArray(bindings) || bindings.length > 32)
    throw new Error("WORKFLOW_BINDING");
  const needs = [];
  for (const b of bindings) {
    if (!b || Object.keys(b).sort().join(",") !== "expression,from,target")
      throw new Error("WORKFLOW_BINDING");
    needs.push(
      ...refCheck({ from: b.from, expression: b.expression }, ids, undefined),
    );
    const ast = portable("standard-expression", { expression: b.target });
    if (
      ast.source !== "request" ||
      !["body", "path", "query", "header"].includes(ast.kind)
    )
      throw new Error("WORKFLOW_BINDING");
  }
  return needs;
}
function checkOwnership(g, description, ids) {
  if (
    !g ||
    Object.keys(g).some(
      (k) => !["request", "bindings", "pointer", "allowed"].includes(k),
    )
  )
    throw new Error("WORKFLOW_OWNERSHIP");
  checkRequest(g.request, description, "GET");
  if (
    typeof g.pointer !== "string" ||
    g.pointer.length > 2048 ||
    !g.pointer.startsWith("/") ||
    /~(?![01])/u.test(g.pointer) ||
    !Array.isArray(g.allowed) ||
    !g.allowed.length ||
    g.allowed.length > 16 ||
    g.allowed.some((x) => typeof x !== "string" || !x || x.length > 256)
  )
    throw new Error("WORKFLOW_OWNERSHIP");
  return checkBindings(g.bindings || [], ids);
}
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
    ![1, 2].includes(model.version) ||
    Object.keys(model).some(
      (k) => !["version", "steps", "cleanup", "initial_state"].includes(k),
    ) ||
    !Array.isArray(model.steps) ||
    !model.steps.length ||
    model.steps.length > 64
  )
    throw new Error("WORKFLOW_MODEL");
  const ids = new Set();
  if (
    model.version === 1 &&
    (model.initial_state !== undefined ||
      model.steps.some(
        (s) => s.requires_state !== undefined || s.set_state !== undefined,
      ))
  )
    throw new Error("WORKFLOW_IR_VERSION");
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
            "ownership",
            "requires_state",
            "set_state",
            "role",
            "authorizationProbe",
            "shrink_inputs",
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
    checkRequest(request, description);
    if (step.shrink_inputs !== undefined) {
      if (!Array.isArray(step.shrink_inputs) || step.shrink_inputs.length > 16)
        throw new Error("WORKFLOW_INPUT_SHRINK");
      for (const target of step.shrink_inputs) {
        const ast = portable("standard-expression", { expression: target });
        if (ast.source !== "request" || !["body", "query"].includes(ast.kind))
          throw new Error("WORKFLOW_INPUT_SHRINK");
        for (const b of step.bindings || []) {
          const bound = portable("standard-expression", {
            expression: b.target,
          });
          if (
            bound.source === ast.source &&
            bound.kind === ast.kind &&
            (ast.kind === "query"
              ? bound.key === ast.key
              : bound.pointer === ast.pointer ||
                bound.pointer.startsWith(ast.pointer + "/") ||
                ast.pointer.startsWith(bound.pointer + "/"))
          )
            throw new Error("WORKFLOW_INPUT_SHRINK_BOUND_TARGET");
        }
      }
    }
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
            s === 429 ||
            (!step.authorizationProbe && [401, 403].includes(s)),
        ))
    )
      throw new Error("WORKFLOW_EXPECT");
    if (
      step.authorizationProbe !== undefined &&
      typeof step.authorizationProbe !== "boolean"
    )
      throw new Error("WORKFLOW_ROLE");
    if (
      step.role !== undefined &&
      (typeof step.role !== "string" ||
        !/^[A-Za-z0-9_.-]{1,64}$/.test(step.role))
    )
      throw new Error("WORKFLOW_ROLE");
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
    if (step.ownership)
      for (const id of checkOwnership(step.ownership, description, ids))
        needs.add(id);
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
        ...(["exists", "absent", "unique"].includes(a.kind) ? [] : [a.right]),
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
  if (model.version === 2)
    portable("resource-state-check", {
      initial: model.initial_state || {},
      steps: metadata(model.steps),
    });
  if (model.cleanup) {
    const cleanupIds = new Set();
    if (!Array.isArray(model.cleanup) || model.cleanup.length > 16)
      throw new Error("WORKFLOW_CLEANUP");
    for (const s of model.cleanup) {
      if (
        !s ||
        typeof s.id !== "string" ||
        !safe.test(s.id) ||
        ids.has(s.id) ||
        cleanupIds.has(s.id) ||
        Object.keys(s).some(
          (k) =>
            !["id", "request", "bindings", "ownership", "role"].includes(k),
        ) ||
        (s.role !== undefined &&
          (typeof s.role !== "string" ||
            !/^[A-Za-z0-9_.-]{1,64}$/.test(s.role)))
      )
        throw new Error("WORKFLOW_CLEANUP");
      checkRequest(s.request, description, "DELETE");
      checkBindings(s.bindings || [], ids);
      checkOwnership(s.ownership, description, ids);
      cleanupIds.add(s.id);
    }
  }
  return model;
}
function metadata(steps) {
  return steps.map(
    ({ id, needs, requires, effects, requires_state, set_state }) => ({
      id,
      needs,
      requires,
      effects,
      requires_state,
      set_state,
    }),
  );
}
function reference(ref, contexts) {
  return Object.hasOwn(ref, "value")
    ? ref.value
    : expression(ref.expression, contexts.get(ref.from) || {});
}
function assertions(step, contexts, deadline) {
  for (const a of step.assertions || []) {
    if (performance.now() >= deadline)
      throw new Error("WORKFLOW_ASSERTION_RESOURCE_BUDGET");
    const left = reference(a.left, contexts),
      right = a.right && reference(a.right, contexts);
    if (
      ["unique", "sum"].includes(a.kind) &&
      Array.isArray(left) &&
      (left.length > 256 || Buffer.byteLength(stringifyExact(left)) > 262144)
    )
      throw new Error("WORKFLOW_ASSERTION_RESOURCE_BUDGET");
    const observed =
      a.kind === "exists"
        ? left !== undefined
        : a.kind === "absent"
          ? left === undefined
          : a.kind === "unique"
            ? Array.isArray(left) &&
              left.every((v, i) => !left.slice(0, i).some((x) => equal(x, v)))
            : a.kind === "sum"
              ? Array.isArray(left) &&
                left.every(numeric) &&
                right !== undefined &&
                numeric(right) &&
                portable("exact-decimal-sum", {
                  values: left.map(decimalIR),
                  expected: decimalIR(right),
                })
              : ["gt", "gte", "lt", "lte"].includes(a.kind)
                ? numeric(left) &&
                  numeric(right) &&
                  portable("exact-decimal-relation", {
                    left: decimalIR(left),
                    right: decimalIR(right),
                    kind: a.kind,
                  })
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
function decimalIR(value) {
  const [coefficient, exponent] = decimal(value);
  return { coefficient: String(coefficient), exponent };
}
export class StandardWorkflow {
  #engine;
  #busy = false;
  #closed = false;
  #cancelReset;
  #sourceDigest;
  static async open(source, options = {}) {
    const workflow = new StandardWorkflow();
    workflow.#engine = await StandardEngine.open(source, options);
    workflow.#sourceDigest = documentDigest(source, options.documents || {});
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
      journalDirectory,
      allowCleanup = false,
      witnessFile,
      witnessKey,
      isolation,
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
    if (model.cleanup && !allowCleanup)
      throw new Error("WORKFLOW_CLEANUP_NOT_AUTHORIZED");
    if (
      witnessFile !== undefined &&
      (!Buffer.isBuffer(witnessKey) || witnessKey.length !== 32)
    )
      throw new Error("WITNESS_KEY_REQUIRED");
    new Engine("{}", { allowRemote: this.#engine.options.allowRemote }).base(
      base,
    );
    // Preflight every side effect before invoking even an authorized reset hook.
    for (const step of [...model.steps, ...(model.cleanup || [])]) {
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
    let ledger;
    try {
      ledger = await ExecutionLedger.open({ directory: journalDirectory });
    } catch {
      this.#busy = false;
      throw new Error("WORKFLOW_LEDGER_OPEN");
    }
    let attempt = 0;
    let lease;
    let leaseFinalized = false;
    const deadline = performance.now() + totalTimeout;
    try {
      if (isolation)
        lease = await IsolationLease.acquire(
          isolation,
          AbortSignal.timeout(totalTimeout),
        );
    } catch {
      ledger.close();
      this.#busy = false;
      throw new Error("WORKFLOW_ISOLATION");
    }
    let attempts = 0;
    const managed = async (request, step_id, expect, step = {}) => {
      if (lease)
        await lease.verify(
          AbortSignal.timeout(
            Math.ceil(Math.max(1, deadline - performance.now())),
          ),
        );
      const current = ++attempt;
      return this.#engine.execute(base, request, {
        remainingMs: Math.max(0, deadline - performance.now()),
        expectedStatuses: expect,
        role: step.role,
        authorizationProbe: step.authorizationProbe,
        onEvent: (event) =>
          ledger.event(current, event.state, { ...event, step_id }),
      });
    };
    const materialize = (s, contexts) => {
      const request = cloneExact(s.request);
      for (const b of s.bindings || []) {
        const v = reference(b, contexts);
        if (
          v === undefined ||
          !bindExpression(request, b.target, cloneExact(v))
        )
          throw new Error("WORKFLOW_BINDING_MISSING");
      }
      return request;
    };
    const guard = async (s, contexts, cleaning = false) => {
      if (!s.ownership) return { valid: true };
      const g = s.ownership,
        result = await managed(
          materialize(g, contexts),
          s.id + ".ownership",
          cleaning ? [200, 404, 410] : [200],
          s,
        );
      if (
        cleaning &&
        result.context &&
        [404, 410].includes(result.context.status)
      )
        return { valid: true, absent: true };
      const marker = result.context
        ? pointer(result.context.response.body, g.pointer)
        : undefined;
      return {
        valid:
          result.record?.passed === true &&
          marker !== undefined &&
          g.allowed.some((x) => equal(x, marker)),
        record: result.record,
      };
    };
    const trial = async (steps, contexts, records) => {
      if (this.#closed)
        return { records, category: "blocked", code: "engine_closed" };
      if (performance.now() >= deadline)
        return { records, category: "budget", code: "total_deadline" };
      if (reset) {
        if (lease)
          await lease.verify(
            AbortSignal.timeout(
              Math.ceil(Math.max(1, deadline - performance.now())),
            ),
          );
        const controller = new AbortController();
        let timer,
          resetTimedOut = false;
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
                  resetTimedOut = true;
                  controller.abort();
                  reject(new Error("WORKFLOW_RESET_TIMEOUT"));
                },
                Math.max(1, deadline - performance.now()),
              );
            }),
          ]);
          if (ok !== true)
            return { records, category: "blocked", code: "reset_unconfirmed" };
        } catch {
          return {
            records,
            category:
              resetTimedOut || performance.now() >= deadline
                ? "budget"
                : "blocked",
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
        if (performance.now() >= deadline)
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
        try {
          const ownership = await guard(step, contexts);
          if (!ownership.valid)
            return { records, category: "blocked", code: "ownership_lost" };
        } catch {
          return {
            records,
            category: "blocked",
            code: "ownership_probe_failed",
          };
        }
        let result, outcome;
        const count = step.poll?.attempts || 1;
        for (let n = 0; n < count; n++) {
          try {
            result = await managed(request, step.id, step.expect, step);
          } catch {
            return {
              records,
              category: "blocked",
              code: "request_contract_or_policy",
            };
          }
          if (!result.record || !result.context) {
            if (result.record)
              records.push({
                step_id: step.id,
                operation_id: request.operation_id,
                ...result.record,
              });
            return {
              records,
              category:
                result.record?.category ||
                (result.blockers.some((b) => b.code === "total_deadline")
                  ? "budget"
                  : "blocked"),
              code:
                result.record?.code ||
                result.blockers[0]?.code ||
                "execution_blocked",
            };
          }
          contexts.set(step.id, result.context);
          try {
            outcome = result.record.passed
              ? assertions(step, contexts, deadline)
              : { passed: false, code: result.record.code };
          } catch (error) {
            outcome = {
              passed: false,
              code:
                error.message === "WORKFLOW_ASSERTION_RESOURCE_BUDGET"
                  ? "assertion_resource_budget"
                  : "assertion_policy_blocked",
            };
          }
          if (
            outcome.passed ||
            n === count - 1 ||
            portable("workflow-category", { code: outcome.code }) !== "defect"
          )
            break;
          // Poll only a successful read with an unmet business assertion or an
          // explicitly declared pending status. Never retry transport or writes.
          if (
            !result.record.passed &&
            !step.poll?.pendingStatuses?.includes(result.record.status)
          )
            break;
          if (performance.now() + step.poll.interval >= deadline)
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
    const run = async (steps) => {
      const contexts = new Map(),
        records = [];
      let result;
      try {
        result = await trial(steps, contexts, records);
      } catch {
        result = { records, category: "blocked", code: "execution_failed" };
      }
      if (model.cleanup) {
        let verified = true;
        for (const s of model.cleanup) {
          // Never guess a resource ID following an uncertain create.
          if ((s.bindings || []).some((b) => !contexts.has(b.from))) {
            verified = false;
            continue;
          }
          try {
            const ownership = await guard(s, contexts, true);
            if (!ownership.valid) {
              verified = false;
              continue;
            }
            if (!ownership.absent) {
              const deleted = await managed(
                materialize(s, contexts),
                s.id,
                [200, 202, 204],
                s,
              );
              if (!deleted.record?.passed || deleted.context?.status === 202) {
                verified = false;
                continue;
              }
              const absence = await guard(s, contexts, true);
              if (!absence.absent) verified = false;
            }
          } catch {
            verified = false;
          }
        }
        result.cleanup_verified = verified;
        if (!verified) {
          result.original_category = result.category;
          result.category = "blocked";
          result.code = "cleanup_unconfirmed";
        }
      }
      return result;
    };
    try {
      const initial = await run(model.steps);
      let retained = model.steps,
        confirmed = false,
        unstable = false;
      let inputAttempts = 0;
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
            if (model.version === 2) {
              try {
                portable("resource-state-check", {
                  initial: model.initial_state || {},
                  steps: metadata(candidate),
                });
              } catch {
                i++;
                continue;
              }
            }
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
            if (performance.now() >= deadline) break;
          }
          if (!model.cleanup) {
            for (const candidate of inputCandidates(retained)) {
              if (
                stringifyExact(candidate).length >=
                stringifyExact(retained).length
              )
                continue;
              if (attempts >= shrinkBudget || performance.now() >= deadline)
                break;
              attempts++;
              inputAttempts++;
              const result = await run(candidate);
              if (
                result.category === "defect" &&
                result.fingerprint === initial.fingerprint
              )
                retained = candidate;
            }
          }
          const final = await run(retained);
          confirmed =
            final.category === "defect" &&
            final.fingerprint === initial.fingerprint;
        }
      }
      let witnessSaved = false;
      if (witnessFile && confirmed) {
        const witnessModel = cloneExact(input);
        witnessModel.steps = cloneExact(retained).map((s) => {
          delete s.needs;
          return s;
        });
        saveEncryptedWitness(
          witnessFile,
          {
            format: 2,
            ir_version: model.version,
            engine_version: VERSION,
            node_version: process.versions.node,
            seed: this.#engine.options.seed,
            document_hash: this.#sourceDigest,
            model: witnessModel,
            model_hash: digestExact(witnessModel),
            fingerprint: initial.fingerprint,
            confirmed: true,
            records: initial.records,
            automatic_write_replay: false,
          },
          witnessKey,
        );
        witnessSaved = true;
      }
      const report = {
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
        execution: ledger.summary(),
        witness_saved: witnessSaved,
        input_shrink_attempts: inputAttempts,
        input_shrink_policy: model.cleanup
          ? "disabled_to_preserve_owned_markers"
          : "explicit_exogenous_targets_only",
      };
      if (lease) {
        leaseFinalized = true;
        let released = false;
        try {
          released = await lease.release();
        } catch {}
        if (!released) {
          report.original_category = report.category;
          report.category = "blocked";
          report.code = "isolation_release_failed";
          report.passed = false;
          report.complete = false;
        }
      }
      return report;
    } finally {
      ledger.close();
      if (lease && !leaseFinalized) {
        try {
          if (!(await lease.release())) this.#closed = true;
        } catch {
          this.#closed = true;
        }
      }
      this.#busy = false;
    }
  }
}

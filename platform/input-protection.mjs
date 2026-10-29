import { cloneExact, equal } from "./standard-value.mjs";
import {
  expression,
  parseExpression,
  requestContext,
} from "./standard-expression.mjs";
export function inputTarget(target) {
  if (typeof target !== "string" || target.length > 2048)
    throw new Error("WORKFLOW_INPUT_TARGET");
  const ast = parseExpression(target);
  if (
    ast.source !== "request" ||
    !["body", "query"].includes(ast.kind) ||
    (ast.kind === "query" && (!ast.key || ast.key.length > 256))
  )
    throw new Error("WORKFLOW_INPUT_TARGET");
  return ast;
}
export function overlappingInputs(a, b) {
  const x = inputTarget(a),
    y = inputTarget(b);
  if (x.kind !== y.kind) return false;
  return x.kind === "query"
    ? x.key === y.key
    : x.pointer === y.pointer ||
        x.pointer.startsWith(y.pointer + "/") ||
        y.pointer.startsWith(x.pointer + "/");
}
// These are caller-declared source locks, not proof about an arbitrary server's
// ownership transformation. Every actual mutation/cleanup retains its GET guard.
export function inputProtection(model) {
  const declarations =
    model.input_protection === undefined ? [] : model.input_protection;
  if (
    !Array.isArray(declarations) ||
    declarations.length > 64 ||
    (declarations.length && model.version !== 2)
  )
    throw new Error("WORKFLOW_INPUT_PROTECTION");
  const seen = new Set(),
    locks = declarations.map((d) => {
      if (
        !d ||
        Object.keys(d).sort().join(",") !== "step,target" ||
        typeof d.step !== "string"
      )
        throw new Error("WORKFLOW_INPUT_PROTECTION");
      inputTarget(d.target);
      const step = model.steps.find((s) => s.id === d.step),
        key = d.step + "\0" + d.target;
      if (!step || seen.has(key)) throw new Error("WORKFLOW_INPUT_PROTECTION");
      seen.add(key);
      const value = expression(d.target, {
        request: requestContext(step.request),
      });
      if (value === undefined) throw new Error("WORKFLOW_INPUT_PROTECTION");
      return { ...d, value: cloneExact(value) };
    });
  const markers = [...model.steps, ...(model.cleanup || [])].flatMap(
    (s) => s.ownership?.allowed ?? [],
  );
  const literals = new Set();
  let nodes = 0;
  const visit = (value, depth = 0) => {
    if (++nodes > 50000 || depth > 64)
      throw new Error("WORKFLOW_INPUT_PROTECTION_BUDGET");
    if (typeof value === "string") literals.add(value);
    else if (value && typeof value === "object")
      for (const v of Object.values(value)) visit(v, depth + 1);
  };
  for (const l of locks) visit(l.value);
  return {
    complete:
      locks.length > 0 &&
      markers.length > 0 &&
      markers.every((m) => literals.has(m)),
    overlaps(step, target) {
      return locks.some(
        (l) => l.step === step && overlappingInputs(l.target, target),
      );
    },
    allows(steps) {
      return locks.every((l) => {
        const step = steps.find((s) => s.id === l.step);
        return (
          !step ||
          equal(
            l.value,
            expression(l.target, { request: requestContext(step.request) }),
          )
        );
      });
    },
  };
}

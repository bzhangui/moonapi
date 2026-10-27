import { cloneExact, stringifyExact, numeric } from "./standard-value.mjs";
import {
  requestContext,
  expression,
  bindExpression,
} from "./standard-expression.mjs";
// Only caller-declared exogenous inputs are considered. This never edits an
// operation, expected result, binding, ownership marker or assertion definition.
export function inputCandidates(steps) {
  const out = [];
  for (let i = 0; i < steps.length; i++)
    for (const target of steps[i].shrink_inputs || []) {
      const value = expression(target, {
        request: requestContext(steps[i].request),
      });
      const candidates =
        typeof value === "string"
          ? [
              "",
              value.slice(0, Math.floor(value.length / 2)),
              value.slice(0, 1),
            ]
          : Array.isArray(value)
            ? [[], value.slice(0, Math.floor(value.length / 2))]
            : numeric(value)
              ? [0]
              : [];
      for (const candidate of candidates) {
        if (stringifyExact(candidate).length >= stringifyExact(value).length)
          continue;
        const changed = cloneExact(steps);
        if (bindExpression(changed[i].request, target, candidate))
          out.push(changed);
        if (out.length >= 64) return out;
      }
    }
  return out;
}

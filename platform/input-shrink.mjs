import {
  cloneExact,
  stringifyExact,
  numeric,
  decimal,
  number,
  setOwn,
} from "./standard-value.mjs";
import {
  requestContext,
  expression,
  bindExpression,
} from "./standard-expression.mjs";
// Only caller-declared exogenous inputs are considered. This never edits an
// operation, expected result, binding, ownership marker or assertion definition.
// Only structural deletions and exact arithmetic; never round int64 through a
// JavaScript Number. Nested candidates remain subject to the workflow's schema
// validation and final independent fingerprint confirmation.
export function shrinkValues(value, depth = 0) {
  if (depth > 8) return [];
  const out = [];
  if (typeof value === "string") {
    const chars = Array.from(value);
    out.push(
      "",
      chars.slice(0, Math.floor(chars.length / 2)).join(""),
      chars[0] ?? "",
    );
  } else if (numeric(value)) {
    const [coefficient, exponent] = decimal(value);
    const suffix = exponent === 0 ? "" : "e" + exponent;
    out.push(
      0,
      number(String(coefficient / 2n) + suffix),
      number(String(coefficient / 10n) + suffix),
    );
  } else if (Array.isArray(value)) {
    out.push([], value.slice(0, Math.floor(value.length / 2)));
    for (let i = 0; i < Math.min(value.length, 16); i++) {
      out.push(value.filter((_, j) => i !== j));
      for (const candidate of shrinkValues(value[i], depth + 1).slice(0, 4)) {
        const changed = cloneExact(value);
        changed[i] = candidate;
        out.push(changed);
      }
    }
  } else if (value && typeof value === "object") {
    for (const key of Object.keys(value).slice(0, 16)) {
      const removed = cloneExact(value);
      delete removed[key];
      out.push(removed);
      for (const candidate of shrinkValues(value[key], depth + 1).slice(0, 4)) {
        const changed = cloneExact(value);
        setOwn(changed, key, candidate);
        out.push(changed);
      }
    }
  }
  const seen = new Set(),
    original = stringifyExact(value);
  return out
    .filter((x) => {
      const text = stringifyExact(x);
      if (
        Buffer.byteLength(text) >= Buffer.byteLength(original) ||
        seen.has(text)
      )
        return false;
      seen.add(text);
      return true;
    })
    .slice(0, 64);
}
export function inputCandidates(steps) {
  const out = [];
  for (let i = 0; i < steps.length; i++)
    for (const target of steps[i].shrink_inputs || []) {
      const value = expression(target, {
        request: requestContext(steps[i].request),
      });
      if (value === undefined) continue;
      const candidates = shrinkValues(value);
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

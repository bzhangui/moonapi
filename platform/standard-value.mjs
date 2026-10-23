// Decimal lexemes survive the wire, worker boundary and constraints unchanged.
import { LosslessNumber, parse, stringify } from "lossless-json";
export { LosslessNumber };
export const numeric = (v) =>
  typeof v === "number" || v instanceof LosslessNumber;
export function decimal(v) {
  const s = String(v);
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(s);
  if (!m) throw new Error("STANDARD_NUMBER");
  let n = BigInt((m[1] || "") + m[2] + (m[3] || ""));
  let e = Number(m[4] || 0) - (m[3]?.length || 0);
  if (!Number.isSafeInteger(e) || Math.abs(e) > 10000)
    throw new Error("STANDARD_NUMBER_BUDGET");
  if (n === 0n) return [0n, 0];
  while (n % 10n === 0n) {
    n /= 10n;
    e++;
  }
  return [n, e];
}
export function compare(a, b) {
  let [x, e] = decimal(a),
    [y, f] = decimal(b);
  const z = Math.min(e, f);
  x *= 10n ** BigInt(e - z);
  y *= 10n ** BigInt(f - z);
  return x < y ? -1 : x > y ? 1 : 0;
}
export function number(s) {
  const exact = new LosslessNumber(s),
    n = Number(s);
  return Number.isFinite(n) && compare(exact, n) === 0 ? n : exact;
}
export const parseExact = (s) => parse(s, undefined, { parseNumber: number });
export const stringifyExact = (v) => stringify(v);
export const cloneExact = (v) =>
  v === undefined ? undefined : parseExact(stringifyExact(v));
export function equal(a, b) {
  if (numeric(a) || numeric(b))
    return numeric(a) && numeric(b) && compare(a, b) === 0;
  if (a === b) return true;
  if (
    !a ||
    !b ||
    typeof a !== "object" ||
    typeof b !== "object" ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((k) => Object.hasOwn(b, k) && equal(a[k], b[k]))
  );
}
export const setOwn = (o, k, v) => {
  Object.defineProperty(o, k, {
    value: v,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  return o;
};
export function shadow(v, seen = new Map()) {
  if (numeric(v)) {
    const n = Number(String(v));
    return Number.isFinite(n) && (n !== 0 || compare(v, 0) === 0)
      ? n
      : compare(v, 0) < 0
        ? -1
        : 1;
  }
  if (!v || typeof v !== "object") return v;
  if (seen.has(v)) return seen.get(v);
  const out = Array.isArray(v) ? [] : {};
  seen.set(v, out);
  for (const [k, x] of Object.entries(v)) setOwn(out, k, shadow(x, seen));
  return out;
}

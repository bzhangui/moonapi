import test from "node:test";
import assert from "node:assert/strict";
import { planningPolicy } from "../platform/planning.mjs";
// Frozen arithmetic reference for migration only, not runtime fallback.
function reference(input) {
  let { coefficient: a, exponent: f } = input.step;
  a = BigInt(a);
  if (input.integer && f < 0) {
    let x = a,
      y = 10n ** BigInt(-f);
    while (y) {
      const z = x % y;
      x = y;
      y = z;
    }
    a /= x;
    f = 0;
  }
  const { coefficient, exponent: e } = input.lower ??
    input.upper ?? { coefficient: "0", exponent: 0 };
  const z = Math.min(e, f),
    value = BigInt(coefficient) * 10n ** BigInt(e - z),
    unit = a * 10n ** BigInt(f - z);
  const up = input.lower !== null || input.upper === null;
  let q = value / unit;
  if ((up && value % unit > 0n) || (!up && value % unit < 0n))
    q += up ? 1n : -1n;
  if (
    value % unit === 0n &&
    (up ? input.exclusive_lower : input.exclusive_upper)
  )
    q += up ? 1n : -1n;
  q += BigInt(input.offset) * (up ? 1n : -1n);
  return { coefficient: String(q * unit), exponent: z };
}
test("MoonBit numeric generator matches exact reference across signs, int64, fractional lattice and open bounds", () => {
  const bounds = [
    null,
    { coefficient: "-21", exponent: -1 },
    { coefficient: "0", exponent: 0 },
    { coefficient: "9223372036854775807", exponent: 0 },
  ];
  let checked = 0;
  for (const lower of bounds)
    for (const upper of bounds)
      for (const integer of [true, false])
        for (const step of [
          { coefficient: "1", exponent: 0 },
          { coefficient: "25", exponent: -2 },
          { coefficient: "6", exponent: -1 },
        ])
          for (const exclusive of [true, false])
            for (const offset of [0, 1, 31]) {
              const input = {
                lower,
                upper,
                integer,
                step,
                offset,
                exclusive_lower: exclusive,
                exclusive_upper: exclusive,
              };
              assert.deepEqual(
                planningPolicy("numeric-candidate", { input }),
                reference(input),
              );
              checked++;
            }
  assert.equal(checked, 576);
});
test("numeric generator rejects zero/negative steps, huge exponents and fractional/oversized offsets", () => {
  const normal = { step: { coefficient: "1", exponent: 0 }, offset: 0 };
  for (const input of [
    { ...normal, offset: -1 },
    { ...normal, offset: 32 },
    { ...normal, offset: 0.5 },
    { ...normal, step: { coefficient: "0", exponent: 0 } },
    { ...normal, step: { coefficient: "-1", exponent: 0 } },
    { ...normal, step: { coefficient: "1", exponent: 10001 } },
  ])
    assert.throws(() => planningPolicy("numeric-candidate", { input }));
});

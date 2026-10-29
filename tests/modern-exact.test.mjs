import test from "node:test";
import assert from "node:assert/strict";
import { probeModernSchema } from "../platform/modern-schema.mjs";
const probe = async (s, raw, options) =>
  probeModernSchema(
    typeof s === "string" ? s : JSON.stringify(s),
    raw,
    options,
  );
test("modern assertions distinguish adjacent int64 bounds and decimals that round to integers", async () => {
  const s =
    '{"type":"integer","minimum":9223372036854775806,"exclusiveMaximum":9223372036854775808}';
  assert.equal((await probe(s, "9223372036854775807")).valid, true);
  assert.equal((await probe(s, "9223372036854775805")).valid, false);
  assert.equal((await probe(s, "9223372036854775808")).valid, false);
  assert.equal(
    (await probe({ type: "integer" }, "1.00000000000000000001")).valid,
    false,
  );
  assert.equal((await probe({ type: "integer" }, "1.0000")).valid, true);
});
test("exact multipleOf does not inherit floating point division false positives or negatives", async () => {
  assert.equal((await probe({ multipleOf: 0.1 }, "0.3")).valid, true);
  assert.equal(
    (await probe({ multipleOf: 0.1 }, "0.30000000000000000001")).valid,
    false,
  );
  assert.equal((await probe('{"multipleOf":1e-1000}', "3e-1000")).valid, true);
  assert.equal(
    (await probe('{"type":"number","minimum":1e400}', "2e400")).valid,
    true,
  );
});
test("const, enum, uniqueItems and contains preserve deep exact equality and key-order independence", async () => {
  assert.equal(
    (await probe('{"enum":[9223372036854775807]}', "9223372036854775806"))
      .valid,
    false,
  );
  assert.equal(
    (
      await probe(
        { uniqueItems: true },
        "[9223372036854775806,9223372036854775807]",
      )
    ).valid,
    true,
  );
  assert.equal(
    (await probe({ uniqueItems: true }, '[{"x":1,"y":2},{"y":2.0,"x":1.0}]'))
      .valid,
    false,
  );
  assert.equal(
    (
      await probe(
        '{"contains":{"const":9223372036854775807},"minContains":1,"maxContains":1}',
        "[9223372036854775806,9223372036854775807]",
      )
    ).valid,
    true,
  );
  assert.equal((await probe({ enum: [] }, "null")).valid, false);
});
test("exact assertions compose with choice applicators, evaluated properties and escaped instance pointers", async () => {
  const s =
    '{"oneOf":[{"type":"object","properties":{"a/b":{"const":9223372036854775806}}},{"type":"object","properties":{"a/b":{"const":9223372036854775807}}}],"unevaluatedProperties":false}';
  assert.equal((await probe(s, '{"a/b":9223372036854775807}')).valid, true);
  assert.equal(
    (await probe(s, '{"a/b":9223372036854775807,"extra":1}')).valid,
    false,
  );
  assert.equal(
    (
      await probe(
        { propertyNames: { enum: ["name"] } },
        '{"name":9223372036854775807}',
      )
    ).valid,
    true,
  );
  assert.equal(
    (await probe({ propertyNames: { enum: ["name"] } }, '{"other":1}')).valid,
    false,
  );
});
test("explicit external resources and nested ids keep original schema numbers and siblings", async () => {
  const documents = {
    "https://schemas.invalid/outer":
      '{"$id":"https://schemas.invalid/outer","$defs":{"id":{"$id":"inner","type":"integer","minimum":9223372036854775807}},"$ref":"inner"}',
  };
  assert.equal(
    (
      await probe(
        { $ref: "https://schemas.invalid/outer", maximum: 9223372036854776000 },
        "9223372036854775807",
        { documents },
      )
    ).valid,
    true,
  );
  assert.equal(
    (
      await probe(
        { $ref: "https://schemas.invalid/outer" },
        "9223372036854775806",
        { documents },
      )
    ).valid,
    false,
  );
  await assert.rejects(
    probe({ $ref: "https://not-granted.invalid/private" }, "0"),
    /INVALID_OR_UNGRANTED/,
  );
});
test("invalid count lexemes, zero divisors, unknown required vocabularies and numeric budgets fail closed", async () => {
  for (const s of [
    '{"minLength":1.00000000000000000001}',
    '{"multipleOf":0}',
    '{"exclusiveMinimum":true}',
  ])
    await assert.rejects(probe(s, "0"), /INVALID_OR_UNGRANTED/);
  await assert.rejects(
    probe({ $vocabulary: { "https://unknown.invalid/assertions": true } }, "0"),
    /DIALECT_UNSUPPORTED/,
  );
  await assert.rejects(
    probe({ type: "integer" }, "1".repeat(4200)),
    /NUMBER_BUDGET/,
  );
  await assert.rejects(probe(true, "10e10000"), /NUMBER_BUDGET/);
  assert.equal((await probe('{"maxLength":1e1000}', '"bounded"')).valid, true);
  assert.equal((await probe('{"minLength":1e1000}', '"bounded"')).valid, false);
  assert.equal(
    (
      await probe({ type: "integer", format: "int64" }, "9223372036854775808", {
        assertFormats: true,
      })
    ).valid,
    false,
  );
});
test("contains evaluation keeps non-prefix index sets across alternatives and reference siblings", async () => {
  const s = {
    allOf: [{ contains: { type: "string" } }, { contains: { type: "number" } }],
    unevaluatedItems: false,
  };
  assert.equal((await probe(s, '["x",1,"y",2]')).valid, true);
  assert.equal((await probe(s, '["x",1,null]')).valid, false);
  const branch = {
    anyOf: [{ prefixItems: [{ const: 0 }] }, { contains: { const: "ok" } }],
    unevaluatedItems: false,
  };
  assert.equal((await probe(branch, '[0,"ok"]')).valid, true);
  assert.equal((await probe(branch, '[1,"ok"]')).valid, false);
});
test("unproductive reference cycles fail closed while recursive data can terminate", async () => {
  await assert.rejects(probe({ $ref: "#" }, "0"), /RESOURCE_BUDGET/);
  const s = {
    $defs: {
      tree: {
        type: "object",
        properties: { next: { $ref: "#/$defs/tree" } },
        additionalProperties: false,
      },
    },
    $ref: "#/$defs/tree",
  };
  assert.equal((await probe(s, '{"next":{"next":{}}}')).valid, true);
  assert.equal((await probe(s, '{"next":{"extra":1}}')).valid, false);
});
test("format assertion policy is explicit and content annotations never decode payloads", async () => {
  assert.equal((await probe({ format: "email" }, '"not-email"')).valid, true);
  assert.equal(
    (await probe({ format: "email" }, '"not-email"', { assertFormats: true }))
      .valid,
    false,
  );
  await assert.rejects(
    probe({ format: "custom" }, '"x"', { assertFormats: true }),
    /FORMAT_UNSUPPORTED/,
  );
  assert.equal(
    (
      await probe(
        {
          contentEncoding: "base64",
          contentMediaType: "application/json",
          contentSchema: false,
        },
        '"not-decoded"',
      )
    ).valid,
    true,
  );
});

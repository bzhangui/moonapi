import test from "node:test";
import assert from "node:assert/strict";
import { prepareModernDocument } from "../platform/modern-document.mjs";
import { modernSchemaTools } from "../platform/modern-generation.mjs";
import {
  encodeModernMedia,
  decodeModernMedia,
} from "../platform/modern-media.mjs";
import {
  equal,
  parseExact,
  stringifyExact,
} from "../platform/standard-value.mjs";

async function toolsFor(schema, extra = {}) {
  const p = await prepareModernDocument(
    stringifyExact({
      openapi: "3.2.1",
      info: { title: "controlled generation", version: "1" },
      paths: {},
      components: { schemas: { Value: schema, ...extra } },
    }),
  );
  return {
    p,
    tools: modernSchemaTools(p),
    schema: p.definition.components.schemas.Value,
  };
}
const mediaOptions = (tools) => ({
  resolveSchema: (schema, value) => tools.shape(schema, value),
  validate: (schema, value) => tools.validate(schema, value),
});

test("patternProperties key generation is reproducible for a fixed seed and revalidates every result", async () => {
  const { tools, schema } = await toolsFor({
    type: "object",
    minProperties: 2,
    patternProperties: { "^[a-z]{8}$": { type: "integer" } },
    additionalProperties: false,
  });
  const first = tools.sample(schema, [], 42),
    second = tools.sample(schema, [], 42);
  assert.deepEqual(first, second);
  assert.equal(Object.keys(first).length, 2);
  assert.equal(tools.validate(schema, first), true);
  assert.deepEqual(tools.sample(schema, [], 73), tools.sample(schema, [], 73));
});

test("dependentSchemas activation generates the ordinary valid state instead of incorrectly exhausting all candidates", async () => {
  const { tools, schema } = await toolsFor({
    type: "object",
    required: ["flag"],
    properties: { flag: { const: true }, x: { type: "integer" } },
    dependentSchemas: {
      flag: { required: ["x"], properties: { x: { minimum: 3 } } },
    },
  });
  assert.equal(tools.validate(schema, { flag: true, x: 3 }), true);
  const sample = tools.sample(schema, [], 42);
  assert.equal(sample.flag, true);
  assert.ok(sample.x >= 3);
  assert.equal(tools.validate(schema, sample), true);
  assert.deepEqual(sample, tools.sample(schema, [], 42));
});

test("referenced oneOf XML resolves the non-first valid branch without leaking synthetic references", async () => {
  const branch = (kind, name) => ({
    type: "object",
    properties: {
      kind: { type: "string", const: kind },
      value: { type: "string" },
    },
    required: ["kind", "value"],
    additionalProperties: false,
    xml: { name, nodeType: "element" },
  });
  const { tools, schema } = await toolsFor(
    { $ref: "#/components/schemas/Choice" },
    { Choice: { oneOf: [branch("a", "Alpha"), branch("b", "Beta")] } },
  );
  const value = { kind: "b", value: "controlled" };
  assert.equal(tools.validate(schema, value), true);
  assert.equal(tools.shape(schema, value).xml.name, "Beta");
  const encoded = encodeModernMedia(
    "application/xml",
    value,
    { schema },
    { ...mediaOptions(tools), rootName: tools.rootName(schema) },
  );
  assert.match(encoded.body.toString(), /^<Beta>/);
  assert.doesNotMatch(encoded.body.toString(), /<Alpha>/);
  const decoded = decodeModernMedia(
    "application/xml",
    encoded.body,
    { schema },
    { ...mediaOptions(tools), rootName: tools.rootName(schema) },
  );
  assert.ok(equal(decoded, value));
  assert.equal(tools.validate(schema, decoded), true);
});

test("root union siblings preserve integer type and exact bounds while choosing branch metadata", async () => {
  const { tools, schema } = await toolsFor({
    type: ["string", "integer"],
    minimum: parseExact("9223372036854775807"),
    oneOf: [
      {
        type: "string",
        minLength: 3,
        xml: { name: "Text", nodeType: "element" },
      },
      { type: "integer", xml: { name: "Number", nodeType: "element" } },
    ],
  });
  const n = parseExact("9223372036854775807");
  assert.equal(tools.validate(schema, n), true);
  const numeric = tools.shape(schema, n);
  assert.equal(numeric.type, "integer");
  assert.equal(numeric.xml.name, "Number");
  const text = tools.shape(schema, "word");
  assert.equal(text.type, "string");
  assert.equal(text.xml.name, "Text");
  assert.equal(
    tools.validate(schema, parseExact("9223372036854775806")),
    false,
  );
});

test("conditional annotation metadata follows the active branch without dropping sibling constraints", async () => {
  const { tools, schema } = await toolsFor({
    type: "object",
    properties: { kind: { type: "string" }, value: { type: "string" } },
    required: ["kind", "value"],
    if: { properties: { kind: { const: "a" } }, required: ["kind"] },
    then: { properties: { value: { xml: { name: "First" } } } },
    else: { properties: { value: { xml: { name: "Second" } } } },
    xml: { name: "Conditional", nodeType: "element" },
  });
  const value = { kind: "b", value: "controlled" };
  assert.equal(tools.validate(schema, value), true);
  assert.equal(tools.shape(schema, value).properties.value.xml.name, "Second");
  assert.equal(
    tools.shape(schema, { kind: "a", value: "controlled" }).properties.value.xml
      .name,
    "First",
  );
  const encoded = encodeModernMedia(
    "application/xml",
    value,
    { schema },
    mediaOptions(tools),
  );
  assert.match(encoded.body.toString(), /<Second>controlled<\/Second>/);
});

test("modern generation does not silently waive required readOnly or writeOnly annotations", async () => {
  const { tools, schema } = await toolsFor({
    type: "object",
    required: ["id", "secret"],
    properties: {
      id: { type: "integer", readOnly: true },
      secret: { type: "string", writeOnly: true },
    },
    additionalProperties: false,
  });
  const value = tools.sample(schema, [], 42);
  assert.equal(Object.hasOwn(value, "id"), true);
  assert.equal(Object.hasOwn(value, "secret"), true);
  assert.equal(tools.validate(schema, value), true);
  assert.equal(tools.validate(schema, { secret: "x" }), false);
  assert.equal(tools.validate(schema, { id: 1 }), false);
});

test("unsatisfied or exhausted generation raises a blocker and never returns a falsely valid sample", async () => {
  for (const input of [
    false,
    { type: "integer", minimum: 10, maximum: 1 },
    { type: "object", required: ["missing"], additionalProperties: false },
  ]) {
    const { tools, schema } = await toolsFor(input);
    assert.throws(
      () => tools.sample(schema, [], 42),
      /GENERATION_UNSAT_OR_BUDGET/,
    );
  }
});

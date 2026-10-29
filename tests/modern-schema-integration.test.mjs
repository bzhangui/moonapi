import test from "node:test";
import assert from "node:assert/strict";
import { compileExactModern } from "../platform/modern-exact.mjs";
import { prepareModernDocument } from "../platform/modern-document.mjs";
import { parseExact } from "../platform/standard-value.mjs";

const dialect = (version) =>
  `https://spec.openapis.org/oas/${version}/dialect/base`;
const compile = (schema, options = {}) =>
  compileExactModern(schema, {}, options);

test("OAS base dialects keep nullable unions and required directional annotations native", () => {
  for (const version of ["3.1", "3.2"]) {
    const schema = {
      $schema: dialect(version),
      type: "object",
      required: ["id"],
      properties: { id: { type: ["integer", "null"], readOnly: true } },
    };
    for (const mode of ["write", "read"]) {
      const validate = compile(schema, { mode });
      assert.equal(
        validate({}).valid,
        false,
        "modern required must not inherit 3.0 waiver",
      );
      assert.equal(validate({ id: null }).valid, true);
      assert.equal(validate({ id: 1 }).valid, true);
    }
    assert.equal(
      compile(schema, { mode: "write", directionPolicy: "reject-forbidden" })({
        id: 1,
      }).valid,
      false,
    );
  }
  for (const selected of [
    "https://spec.openapis.org/oas/3.1/dialect/2024-10-25",
    "https://spec.openapis.org/oas/3.1/dialect/2024-11-10",
    "https://spec.openapis.org/oas/3.2/dialect/2025-09-17",
    "https://spec.openapis.org/oas/3.2/dialect/2026-02-26",
  ])
    assert.equal(
      compile({ $schema: selected, type: ["string", "null"] })(null).valid,
      true,
    );
});

test("physical Schema URI registry crosses OADs without validating OAD objects as Schema", async () => {
  const source = JSON.stringify({
    openapi: "3.2.1",
    info: { title: "controlled schemas", version: "1" },
    paths: {},
    components: {
      schemas: {
        Response: {
          type: "object",
          properties: {
            "a%b": {
              $ref: "other.json#/components/schemas/Big",
              maximum: 9223372036854776000,
            },
          },
          required: ["a%b"],
          additionalProperties: false,
        },
      },
    },
  });
  const other =
    '{"openapi":"3.1.2","info":{"title":"other","version":"1"},"components":{"schemas":{"Big":{"$id":"big.json","$anchor":"id","type":"integer","minimum":9223372036854775807}}}}';
  const prepared = await prepareModernDocument(source, {
    documentURI: "https://api.invalid/root.json",
    documents: { "https://api.invalid/other.json": other },
  });
  const root = prepared.schemaRoots.find(
    (root) => root.schema === prepared.definition.components.schemas.Response,
  );
  const validate = compile(root.schema, {
    schemaRegistry: prepared.schemaRegistry,
    schemaDialects: prepared.schemaLocations,
    rootURI: root.uri,
    dialect: root.dialect,
  });
  assert.equal(validate(parseExact('{"a%b":9223372036854775807}')).valid, true);
  assert.equal(
    validate(parseExact('{"a%b":9223372036854775806}')).valid,
    false,
  );
  assert.equal(
    validate(parseExact('{"a%b":9223372036854775807,"extra":1}')).valid,
    false,
  );
});

test("registry aliases and nested resource ids retain dynamic and escaped pointer identity", async () => {
  const doc = {
    openapi: "3.2.1",
    info: { title: "controlled identities", version: "1" },
    paths: {},
    components: {
      schemas: {
        Special: {
          type: "object",
          required: ["%"],
          properties: {
            "%20": { type: "integer", const: 1 },
            "%": {
              $ref: "#/components/schemas/Special/properties/%2520",
              maximum: 2,
            },
          },
        },
        Anchor: {
          $id: "ids.json",
          $anchor: "value",
          type: "integer",
          minimum: 3,
        },
        Use: { $ref: "ids.json#value", maximum: 4 },
      },
    },
  };
  const p = await prepareModernDocument(JSON.stringify(doc));
  for (const name of ["Special", "Use"]) {
    const schema = p.definition.components.schemas[name],
      location = p.schemaLocations.get(schema);
    const validate = compile(schema, {
      schemaRegistry: p.schemaRegistry,
      schemaDialects: p.schemaLocations,
      rootURI: location.uri,
      dialect: location.dialect,
    });
    assert.equal(validate(name === "Special" ? { "%": 1 } : 3).valid, true);
    assert.equal(validate(name === "Special" ? { "%": 2 } : 2).valid, false);
  }
});

test("3.2 XML node types and discriminator defaults are validated as annotations, never assertion overrides", () => {
  const options = { dialect: dialect("3.2") };
  for (const nodeType of ["element", "attribute", "text", "cdata", "none"])
    assert.equal(
      compile(
        { type: "string", xml: { nodeType, name: "synthetic" } },
        options,
      )("x").valid,
      true,
    );
  const schema = {
    oneOf: [{ type: "string" }, { type: "integer" }],
    discriminator: {
      propertyName: "kind",
      defaultMapping: "Any",
      mapping: { x: "Named" },
    },
  };
  assert.equal(compile(schema, options)("x").valid, true);
  assert.equal(compile(schema, options)(false).valid, false);
  for (const bad of [
    { xml: { nodeType: "bogus" } },
    { xml: { nodeType: "element", wrapped: false } },
    { xml: { nodeType: "text", attribute: false } },
    { xml: { namespace: "relative/path" } },
    { xml: { wrapped: "yes" } },
    { discriminator: { propertyName: 1 } },
    { discriminator: { propertyName: "kind", mapping: { x: false } } },
    { externalDocs: { description: "missing URL" } },
  ])
    assert.throws(() => compile(bad, options), /INVALID_OR_UNGRANTED/);
  assert.throws(
    () =>
      compile({ xml: { nodeType: "element" } }, { dialect: dialect("3.1") }),
    /INVALID_OR_UNGRANTED/,
  );
  assert.throws(
    () => compile(schema, { dialect: dialect("3.1") }),
    /INVALID_OR_UNGRANTED/,
  );
  assert.equal(compile({ xml: "custom annotation" })(null).valid, true);
});

test("binary non-JSON instances are not mistaken for JSON objects and exact equality stays isolated", () => {
  const bytes = Buffer.from([0, 255, 128]);
  assert.equal(
    compile({ contentMediaType: "application/octet-stream" })(bytes).valid,
    true,
  );
  for (const type of [
    "object",
    "array",
    "string",
    "integer",
    "number",
    "boolean",
    "null",
  ])
    assert.equal(compile({ type })(bytes).valid, false);
  assert.equal(
    compile({ const: { 0: 0, 1: 255, 2: 128 } })(bytes).valid,
    false,
  );
  assert.equal(
    compile({ type: "array", uniqueItems: true })([
      bytes,
      new Uint8Array(bytes),
    ]).valid,
    false,
  );
  assert.equal(
    compile({ type: "array", uniqueItems: true })([
      bytes,
      Buffer.from([0, 255, 129]),
    ]).valid,
    true,
  );
});

test("required unsupported dialect vocabularies fail before any evaluation instead of weakening constraints", () => {
  assert.throws(
    () =>
      compile({ $schema: "https://ungranted.invalid/dialect", type: "number" }),
    /DIALECT_UNSUPPORTED/,
  );
  assert.throws(
    () =>
      compile(
        {
          $vocabulary: {
            "https://json-schema.org/draft/2020-12/vocab/format-assertion": true,
          },
        },
        { assertFormats: true },
      ),
    /DIALECT_UNSUPPORTED/,
  );
  assert.throws(
    () =>
      compile({ $vocabulary: { "https://unimplemented.invalid/vocab": true } }),
    /DIALECT_UNSUPPORTED/,
  );
  assert.equal(
    compile({
      $vocabulary: { "https://unimplemented.invalid/vocab": false },
      type: "number",
    })("x").valid,
    false,
  );
});

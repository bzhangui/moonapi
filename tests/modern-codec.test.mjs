import test from "node:test";
import assert from "node:assert/strict";
import { prepareModernDocument } from "../platform/modern-document.mjs";
import { modernSchemaTools } from "../platform/modern-generation.mjs";
import {
  serializeParameter,
  deserializeParameter,
  encodeRequest,
} from "../platform/standard-codec.mjs";
import {
  decodeModernHeader,
  encodeModernMedia,
  decodeModernMedia,
  decodeModernCookie,
  decodeSetCookieHeader,
  encodeSetCookieHeader,
} from "../platform/modern-media.mjs";
import {
  equal,
  parseExact,
  stringifyExact,
} from "../platform/standard-value.mjs";

async function toolsFor(schema, extras = {}) {
  const prepared = await prepareModernDocument(
    stringifyExact({
      openapi: "3.2.1",
      info: { title: "Controlled codec regression", version: "1" },
      paths: {},
      components: { schemas: { Value: schema, ...extras } },
    }),
  );
  const tools = modernSchemaTools(prepared),
    original = prepared.definition.components.schemas.Value;
  return {
    schema: original,
    tools,
    options: {
      resolveSchema: (s, v) => tools.shape(s, v),
      validate: (s, v) => tools.validate(s, v),
      rootName: tools.rootName(original),
    },
  };
}
const same = (a, b) => assert.ok(equal(a, b), "exact data differs");
test("modern cookie style is wired through request serialization and parameter decoding without URI mutation", async () => {
  const { schema, tools, options } = await toolsFor({
    type: "object",
    required: ["greeting", "n"],
    properties: {
      greeting: { const: "Hello%2C%20world!" },
      n: { type: "integer" },
    },
    additionalProperties: false,
  });
  const p = {
      name: "settings",
      in: "cookie",
      style: "cookie",
      modern: true,
      schema: tools.shape(schema),
    },
    value = { greeting: "Hello%2C%20world!", n: 42 };
  const encoded = encodeRequest(
    { path: "/cookies", parameters: [p], modern: true },
    { parameters: [{ in: "cookie", name: "settings", value }] },
    options,
  );
  assert.equal(encoded.headers.cookie, "greeting=Hello%2C%20world!; n=42");
  same(
    deserializeParameter(
      p,
      { headers: { cookie: encoded.headers.cookie } },
      options,
    ),
    value,
  );
  assert.throws(
    () => serializeParameter({ ...p, explode: false }, value, options),
    /COOKIE_PARAMETER/,
  );
});
test("modern query and header type unions use full original constraints instead of the first metadata type", async () => {
  const { schema, tools, options } = await toolsFor({
    type: ["number", "string"],
    const: "1",
  });
  const p = {
    modern: true,
    name: "value",
    in: "query",
    schema: tools.shape(schema),
  };
  assert.equal(deserializeParameter(p, { query: "?value=1" }, options), "1");
  assert.equal(
    decodeModernHeader({ schema: tools.shape(schema) }, "1", options),
    "1",
  );
  assert.equal(
    deserializeParameter(
      { ...p, in: "header" },
      { headers: { value: "1" } },
      options,
    ),
    "1",
  );
});
test("modern arrays combine item coercion candidates and validate the parent contains constraint", async () => {
  const { schema, tools, options } = await toolsFor({
    type: "array",
    items: { type: ["string", "number"] },
    contains: { type: "number" },
    minContains: 1,
  });
  const p = {
    modern: true,
    name: "values",
    in: "query",
    schema: tools.shape(schema),
    explode: true,
  };
  const value = deserializeParameter(
    p,
    { query: "?values=1&values=word" },
    options,
  );
  assert.equal(value[0], 1);
  assert.equal(value[1], "word");
  assert.equal(tools.validate(schema, value), true);
  const header = decodeModernHeader(
    { schema: tools.shape(schema) },
    "1,word",
    options,
  );
  assert.equal(tools.validate(schema, header), true);
  assert.equal(typeof header[0], "number");
});
test("modern simple headers preserve exact integers and validate exploded dictionary values", async () => {
  const big = parseExact("9223372036854775807"),
    integer = await toolsFor({ type: "integer", const: big });
  same(
    decodeModernHeader(
      { schema: integer.tools.shape(integer.schema) },
      String(big),
      integer.options,
    ),
    big,
  );
  assert.throws(
    () =>
      decodeModernHeader(
        { schema: integer.tools.shape(integer.schema) },
        "9223372036854775806",
        integer.options,
      ),
    /WIRE/,
  );
  const object = await toolsFor({
    type: "object",
    required: ["count", "flag"],
    properties: { count: { type: "integer" }, flag: { type: "boolean" } },
    additionalProperties: false,
  });
  same(
    decodeModernHeader(
      { schema: object.tools.shape(object.schema), explode: true },
      "count=7,flag=true",
      object.options,
    ),
    { count: 7, flag: true },
  );
});
test("modern CSV URL parsing separates raw delimiters before decoding escaped values", async () => {
  const { schema, tools, options } = await toolsFor({
    type: "array",
    items: { type: "string" },
    minItems: 2,
    maxItems: 2,
  });
  const p = {
      modern: true,
      in: "query",
      name: "values",
      schema: tools.shape(schema),
      style: "form",
      explode: false,
    },
    value = ["a,b", "c+d"];
  const serialized = serializeParameter(p, value, options).join("&");
  assert.equal(serialized, "values=a%2Cb,c%2Bd");
  same(deserializeParameter(p, { query: serialized }, options), value);
  const path = { ...p, in: "path", style: "simple" };
  same(
    deserializeParameter(
      path,
      { path: { values: serializeParameter(path, value, options) } },
      options,
    ),
    value,
  );
});
test("modern URI reserved plus is not interpreted using form-urlencoded plus-as-space rules", async () => {
  const { schema, tools, options } = await toolsFor({
      const: "a+b",
      type: "string",
    }),
    p = {
      modern: true,
      in: "query",
      name: "value",
      allowReserved: true,
      schema: tools.shape(schema),
    };
  const wire = serializeParameter(p, "a+b", options).join("&");
  assert.equal(wire, "value=a+b");
  assert.equal(deserializeParameter(p, { query: wire }, options), "a+b");
});
test("modern matrix, label and deepObject keep typed values and reject ambiguous duplicate scalar data", async () => {
  const object = await toolsFor({
    type: "object",
    required: ["n", "flag"],
    properties: { n: { type: "integer" }, flag: { type: "boolean" } },
    additionalProperties: false,
  });
  for (const style of ["matrix", "label"]) {
    const p = {
        modern: true,
        in: "path",
        name: "value",
        style,
        explode: true,
        schema: object.tools.shape(object.schema),
      },
      value = { n: 4, flag: true };
    same(
      deserializeParameter(
        p,
        { path: { value: serializeParameter(p, value, object.options) } },
        object.options,
      ),
      value,
    );
  }
  const p = {
    modern: true,
    in: "query",
    name: "value",
    style: "deepObject",
    schema: object.tools.shape(object.schema),
  };
  same(
    deserializeParameter(
      p,
      { query: "value%5Bn%5D=4&value%5Bflag%5D=true" },
      object.options,
    ),
    { n: 4, flag: true },
  );
  const scalar = await toolsFor({ type: "integer" });
  assert.throws(
    () =>
      deserializeParameter(
        {
          modern: true,
          in: "query",
          name: "value",
          schema: scalar.tools.shape(scalar.schema),
        },
        { query: "value=1&value=2" },
        scalar.options,
      ),
    /WIRE/,
  );
});
test("modern XML type-union scalar items can select different valid types within the same array", async () => {
  const { schema, options } = await toolsFor({
    type: "array",
    xml: { nodeType: "element", name: "Values" },
    items: {
      type: ["number", "string"],
      enum: ["1", 2],
      xml: { name: "Value", nodeType: "element" },
    },
  });
  const value = ["1", 2],
    encoded = encodeModernMedia("application/xml", value, { schema }, options),
    decoded = decodeModernMedia(
      "application/xml",
      encoded.body,
      { schema },
      options,
    );
  same(decoded, value);
});
test("modern XML oneOf item annotations can vary per array element without choosing the first branch globally", async () => {
  const branch = (kind, name) => ({
    type: "object",
    xml: { name },
    properties: { kind: { const: kind, type: "string" } },
    required: ["kind"],
    additionalProperties: false,
  });
  const { schema, options } = await toolsFor({
    type: "array",
    xml: { nodeType: "element", name: "Values" },
    items: { oneOf: [branch("a", "Alpha"), branch("b", "Beta")] },
  });
  const value = [{ kind: "b" }, { kind: "a" }],
    encoded = encodeModernMedia("application/xml", value, { schema }, options),
    decoded = decodeModernMedia(
      "application/xml",
      encoded.body,
      { schema },
      options,
    );
  same(decoded, value);
});

test("modern ambiguous wire coercion distinguishes resource exhaustion from an actual invalid contract", async () => {
  const example = await toolsFor({
    type: "array",
    items: { type: ["string", "integer"] },
    contains: { type: "integer" },
    minContains: 7,
  });
  const p = {
    modern: true,
    name: "values",
    in: "query",
    schema: example.tools.shape(example.schema),
    explode: true,
  };
  assert.throws(
    () =>
      deserializeParameter(
        p,
        { query: Array.from({ length: 7 }, () => "values=1").join("&") },
        example.options,
      ),
    /^Error: MODERN_WIRE_COERCION_BUDGET$/,
  );
  assert.throws(
    () =>
      decodeModernHeader(
        { schema: p.schema },
        "1,1,1,1,1,1,1",
        example.options,
      ),
    /^Error: MODERN_WIRE_COERCION_BUDGET$/,
  );
  assert.throws(
    () => deserializeParameter(p, { query: "values=word" }, example.options),
    /^Error: MODERN_WIRE_VALUE_CONTRACT$/,
  );
  const exhaustive = await toolsFor({
    type: "array",
    items: { type: ["string", "integer"] },
    contains: { type: "integer" },
    minContains: 6,
  });
  const result = decodeModernHeader(
    { schema: exhaustive.tools.shape(exhaustive.schema) },
    "1,1,1,1,1,1",
    exhaustive.options,
  );
  same(result, [1, 1, 1, 1, 1, 1]);
});

test("OpenAPI Link content uses the RFC9264 text mapping rather than JSON body serialization", async () => {
  const original = {
    type: "object",
    required: ["linkset"],
    properties: { linkset: { type: "array", items: { type: "object" } } },
    additionalProperties: false,
  };
  const { schema, options } = await toolsFor(original),
    value = {
      linkset: [
        {
          anchor: "https://example.test/source",
          next: [
            {
              href: "https://example.test/next",
              title: "Next, chapter",
              hreflang: ["en", "de"],
            },
          ],
        },
      ],
    };
  const content = { schema },
    encoded = encodeModernMedia("application/linkset", value, content, options);
  assert.match(
    encoded.body.toString(),
    /^<https:\/\/example\.test\/next>; rel="next"/,
  );
  assert.equal(encoded.contentType, "application/linkset");
  same(
    decodeModernMedia("application/linkset", encoded.body, content, options),
    value,
  );
  const parameter = {
    modern: true,
    in: "header",
    name: "Link",
    content: "application/linkset",
    contentDefinition: { "application/linkset": content },
  };
  const [, wire] = serializeParameter(parameter, value, options);
  same(
    deserializeParameter(parameter, { headers: { link: wire } }, options),
    value,
  );
  same(
    decodeModernHeader(
      { content: { "application/linkset": content } },
      wire,
      options,
    ),
    value,
  );
  assert.throws(
    () =>
      decodeModernHeader(
        { content: { "application/linkset": content } },
        wire + "\r\n",
        options,
      ),
    /HEADER_WIRE/,
  );
});

test("Cookie parent constraints choose valid union elements instead of greedily selecting string metadata", async () => {
  const array = await toolsFor({
      type: "array",
      items: { type: ["string", "integer"] },
      contains: { type: "integer" },
      minContains: 1,
    }),
    p = {
      in: "cookie",
      name: "values",
      style: "cookie",
      schema: array.tools.shape(array.schema),
    };
  same(decodeModernCookie(p, "values=1; values=word", array.options), [
    1,
    "word",
  ]);
  const object = await toolsFor({
    type: "object",
    properties: { n: { type: ["string", "number"] } },
    required: ["n"],
    const: { n: 1 },
  });
  same(
    decodeModernCookie(
      { ...p, schema: object.tools.shape(object.schema) },
      "n=1",
      object.options,
    ),
    { n: 1 },
  );
  const union = await toolsFor({ type: ["number", "string"], const: "1" });
  assert.equal(
    decodeModernCookie(
      { ...p, schema: union.tools.shape(union.schema) },
      "values=1",
      union.options,
    ),
    "1",
  );
  assert.equal(
    decodeModernCookie(
      { ...p, schema: union.tools.shape(union.schema) },
      "unrelated=x",
      union.options,
    ),
    undefined,
  );
  const exhausted = await toolsFor({
    type: "array",
    items: { type: ["string", "integer"] },
    contains: { type: "integer" },
    minContains: 7,
  });
  assert.throws(
    () =>
      decodeModernCookie(
        { ...p, schema: exhausted.tools.shape(exhausted.schema) },
        Array.from({ length: 7 }, () => "values=1").join("; "),
        exhausted.options,
      ),
    /MODERN_WIRE_COERCION_BUDGET$/,
  );
  assert.throws(
    () => decodeModernCookie(p, "values=word", array.options),
    /MODERN_WIRE_VALUE_CONTRACT$/,
  );
});

test("Set-Cookie applies parent constraints to exploded fields and repeated array properties without joining lines", async () => {
  const object = await toolsFor({
      type: "object",
      required: ["n", "items", "literal"],
      properties: {
        n: { type: ["string", "number"] },
        items: {
          type: "array",
          items: { type: ["string", "integer"] },
          contains: { type: "integer" },
          minContains: 1,
        },
        literal: { type: "string" },
      },
      const: {
        n: 1,
        items: [1, "word"],
        literal: "x%2C; Expires=Wed, 09 Jun 2021 10:18:14 GMT",
      },
    }),
    header = { explode: true, schema: object.tools.shape(object.schema) },
    value = {
      n: 1,
      items: [1, "word"],
      literal: "x%2C; Expires=Wed, 09 Jun 2021 10:18:14 GMT",
    },
    lines = encodeSetCookieHeader(header, value, object.options);
  assert.equal(lines.length, 4);
  same(decodeSetCookieHeader(header, lines, object.options), value);
  const union = await toolsFor({
    type: ["string", "array"],
    items: { type: "string" },
    const: ["a=1", "a=2"],
  });
  same(
    decodeSetCookieHeader(
      { schema: union.tools.shape(union.schema) },
      ["a=1", "a=2"],
      union.options,
    ),
    ["a=1", "a=2"],
  );
  const exhausted = await toolsFor({
    type: "object",
    properties: {
      items: {
        type: "array",
        items: { type: ["string", "integer"] },
        contains: { type: "integer" },
        minContains: 7,
      },
    },
    required: ["items"],
  });
  assert.throws(
    () =>
      decodeSetCookieHeader(
        { explode: true, schema: exhausted.tools.shape(exhausted.schema) },
        Array.from({ length: 7 }, () => "items=1"),
        exhausted.options,
      ),
    /MODERN_WIRE_COERCION_BUDGET$/,
  );
  assert.throws(
    () =>
      decodeSetCookieHeader(
        header,
        ["n=word", "items=word", "literal=x"],
        object.options,
      ),
    /MODERN_WIRE_VALUE_CONTRACT$/,
  );
});

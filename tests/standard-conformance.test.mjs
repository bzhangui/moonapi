import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { StandardEngine } from "../platform/standard.mjs";
import {
  parseExact,
  stringifyExact,
  number,
  compare,
  equal,
} from "../platform/standard-value.mjs";
import { validSchema } from "../platform/standard-schema.mjs";
import { encodeMedia, decodeMedia } from "../platform/standard-media.mjs";
import { encodeXML, decodeXML } from "../platform/standard-xml.mjs";
import {
  expression,
  bindExpression,
} from "../platform/standard-expression.mjs";
import {
  serializeParameter,
  deserializeParameter,
} from "../platform/standard-codec.mjs";
const ack = { description: "synthetic acknowledgement" };
const doc = () => ({
  openapi: "3.0.4",
  info: { title: "Owned conformance fixture", version: "1" },
  paths: {
    "/test": {
      post: { operationId: "test", responses: { 200: ack, 400: ack } },
    },
  },
});
async function use(d, fn, options = {}) {
  const e = await StandardEngine.open(
    typeof d === "string" ? d : stringifyExact(d),
    options,
  );
  try {
    return await fn(e);
  } finally {
    await e.close();
  }
}
async function serve(fn) {
  const s = http.createServer(fn);
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  return {
    base: `http://127.0.0.1:${s.address().port}`,
    async close() {
      s.closeAllConnections();
      await new Promise((r) => s.close(r));
    },
  };
}
test("lossless JSON preserves signed int64, decimal bounds, multipleOf, enum and uniqueness", () => {
  for (const text of [
    "9223372036854775807",
    "-9223372036854775808",
    "0.123456789012345678901",
    "1e400",
  ]) {
    const v = parseExact(text);
    assert.equal(compare(v, number(text)), 0);
    assert.equal(compare(parseExact(stringifyExact(v)), v), 0);
  }
  const s = { type: "integer", format: "int64" };
  assert.ok(validSchema(s, number("9223372036854775807")));
  assert.ok(!validSchema(s, number("9223372036854775808")));
  assert.ok(!validSchema(s, number("-9223372036854775809")));
  assert.ok(
    validSchema(
      { type: "number", multipleOf: number("0.0000000000000000001") },
      number("0.0000000000000000003"),
    ),
  );
  assert.ok(
    !validSchema(
      { type: "number", maximum: number("0.1234567890123456789") },
      number("0.1234567890123456790"),
    ),
  );
  assert.ok(
    !validSchema(
      { type: "number", enum: [number("9007199254740993")] },
      number("9007199254740992"),
    ),
  );
  assert.ok(
    !validSchema({ type: "array", uniqueItems: true }, [1, number("1.0")]),
  );
});
test("XML metadata covers namespaces attributes wrapped/unwrapped arrays and rejects XXE", () => {
  const s = {
    type: "object",
    xml: { name: "Person", prefix: "p", namespace: "urn:people" },
    properties: {
      id: { type: "integer", format: "int64", xml: { attribute: true } },
      name: { type: "string", xml: { namespace: "urn:names", prefix: "n" } },
      tags: {
        type: "array",
        xml: { wrapped: true, name: "labels" },
        items: { type: "string", xml: { name: "label" } },
      },
      pets: { type: "array", items: { type: "string", xml: { name: "pet" } } },
    },
  };
  const value = {
    id: number("9007199254740993"),
    name: 'a<&"b',
    tags: ["red", "blue"],
    pets: ["cat", "dog"],
  };
  const xml = encodeXML(s, value);
  assert.match(xml, /p:Person/);
  assert.match(xml, /<labels><label>/);
  assert.ok(equal(decodeXML(s, xml), value));
  for (const raw of [
    '<!DOCTYPE a [<!ENTITY x SYSTEM "file:///not-granted">]><a>&x;</a>',
    "<a><b></a>",
    '<p:Person xmlns:p="urn:wrong"/>',
  ])
    assert.throws(() => decodeXML(s, raw));
});
test("Encoding Object supports form and multipart JSON XML headers repeated arrays and binary", () => {
  const schema = {
    type: "object",
    properties: {
      meta: { type: "object", properties: { id: { type: "integer" } } },
      files: { type: "array", items: { type: "string", format: "binary" } },
      tags: { type: "array", items: { type: "string" } },
      xml: {
        type: "object",
        xml: { name: "item" },
        properties: { ok: { type: "boolean" } },
      },
    },
  };
  const content = {
    schema,
    encoding: {
      meta: {
        contentType: "application/json",
        headers: {
          "X-Part": {
            required: true,
            schema: { type: "string", enum: ["synthetic"] },
          },
        },
      },
      xml: { contentType: "application/xml" },
    },
  };
  const value = {
    meta: { id: 7 },
    files: ["\x00\xffabc", "def"],
    tags: ["red", "blue"],
    xml: { ok: true },
  };
  const encoded = encodeMedia("multipart/form-data", value, content);
  assert.match(encoded.body.toString("latin1"), /X-Part: synthetic/);
  assert.ok(
    equal(decodeMedia(encoded.contentType, encoded.body, content), value),
  );
  const form = {
    schema: {
      type: "object",
      properties: {
        meta: schema.properties.meta,
        tags: schema.properties.tags,
      },
    },
    encoding: {
      meta: { contentType: "application/json" },
      tags: { style: "pipeDelimited", explode: false },
    },
  };
  const v = { meta: { id: 3 }, tags: ["a", "b"] },
    w = encodeMedia("application/x-www-form-urlencoded", v, form);
  assert.ok(equal(decodeMedia(w.contentType, w.body, form), v));
  assert.throws(() =>
    decodeMedia("multipart/form-data", Buffer.from("bad"), content),
  );
});
test("every parameter style defines scalar array object, reserved expansion is injection-safe", () => {
  for (const style of ["simple", "label", "matrix"])
    for (const explode of [false, true])
      for (const value of ["x/y", [1, 2], { a: 1, b: 2 }])
        assert.equal(
          typeof serializeParameter(
            { name: "id", in: "path", style, explode },
            value,
          ),
          "string",
        );
  for (const style of ["form", "spaceDelimited", "pipeDelimited", "deepObject"])
    for (const explode of [false, true]) {
      const value = style === "deepObject" ? { a: 1, b: 2 } : [1, 2];
      assert.ok(
        Array.isArray(
          serializeParameter({ name: "q", in: "query", style, explode }, value),
        ),
      );
    }
  const encoded = serializeParameter(
    { name: "q", in: "query", allowReserved: true },
    "a&b=1+#[]/%2F",
  )[0];
  assert.match(encoded, /%26/);
  assert.match(encoded, /%3D/);
  assert.match(encoded, /%2B/);
  assert.match(encoded, /%23/);
  assert.match(encoded, /%2F/);
  assert.equal(encoded.split("&").length, 1);
});
test("runtime expressions preserve values and distinguish absent, false, zero, escaped pointers", () => {
  const c = {
    url: "http://fixture/",
    method: "POST",
    status: 201,
    request: {
      body: { "a/b": { "~key": false } },
      header: { "X-ID": "secret" },
      query: { q: 0 },
      path: { id: 7 },
    },
    response: {
      body: { id: number("9007199254740993") },
      header: { Location: "/next" },
    },
  };
  for (const [e, v] of [
    ["$method", "POST"],
    ["$statusCode", "201"],
    ["$request.body#/a~1b/~0key", false],
    ["$request.query.q", 0],
    ["$request.path.id", 7],
    ["$request.header.x-id", "secret"],
    ["$response.header.location", "/next"],
    ["{$url}done", "http://fixture/done"],
  ])
    assert.equal(expression(e, c), v);
  assert.equal(expression("$response.body#/absent", c), undefined);
  assert.equal(
    compare(expression("$response.body#/id", c), number("9007199254740993")),
    0,
  );
  assert.throws(() => expression("$response.body#/bad~2key", c));
  const request = { parameters: [], body: { url: "" } };
  assert.ok(
    bindExpression(request, "{$request.body#/url}", "http://127.0.0.1/owned"),
  );
  assert.equal(request.body.url, "http://127.0.0.1/owned");
});
test("discriminator selection does not replace oneOf validation or parent allOf semantics", async () => {
  const d = doc();
  d.components = {
    schemas: {
      Cat: {
        type: "object",
        required: ["kind", "meow"],
        properties: {
          kind: { type: "string", enum: ["cat"] },
          meow: { type: "boolean" },
        },
      },
      Dog: {
        type: "object",
        required: ["kind", "bark"],
        properties: {
          kind: { type: "string", enum: ["dog"] },
          bark: { type: "integer" },
        },
      },
    },
  };
  d.paths["/test"].post.requestBody = {
    required: true,
    content: {
      "application/json": {
        schema: {
          oneOf: [
            { $ref: "#/components/schemas/Cat" },
            { $ref: "#/components/schemas/Dog" },
          ],
          discriminator: {
            propertyName: "kind",
            mapping: {
              cat: "#/components/schemas/Cat",
              dog: "#/components/schemas/Dog",
            },
          },
        },
      },
    },
  };
  await use(d, async (e) => {
    assert.deepEqual((await e.plan()).blockers, []);
    for (const [body, valid] of [
      [{ kind: "cat", meow: true }, true],
      [{ kind: "dog", bark: 1 }, true],
      [{ kind: "dog", meow: true }, false],
    ])
      assert.equal(
        (
          await e.validateRequest({
            operation_id: "test",
            parameters: [],
            media: "application/json",
            body,
          })
        ).valid,
        valid,
      );
  });
});
test("legal prototype-named business properties do not pollute prototypes", async () => {
  const d = doc();
  d.paths["/test"].post.requestBody = {
    content: {
      "application/json": {
        schema: parseExact(
          '{"type":"object","required":["__proto__","constructor"],"properties":{"__proto__":{"type":"string"},"constructor":{"type":"integer"}}}',
        ),
      },
    },
  };
  const original =
    d.paths["/test"].post.requestBody.content["application/json"].schema;
  d.paths["/test"].post.requestBody.content["application/json"].schema = {
    allOf: [original, { type: "object" }],
  };
  await use(d, async (e) => {
    const p = await e.plan();
    assert.deepEqual(p.blockers, []);
    assert.equal(
      (
        await e.validateRequest({
          operation_id: "test",
          parameters: [],
          media: "application/json",
          body: parseExact('{"__proto__":"data","constructor":7}'),
        })
      ).valid,
      true,
    );
    assert.equal({}.polluted, undefined);
  });
});
test("wire contracts preserve exact int64 across JSON YAML request response and XML", async () => {
  const d = doc(),
    s = {
      type: "object",
      required: ["id"],
      properties: {
        id: {
          type: "integer",
          format: "int64",
          minimum: number("9007199254740993"),
          maximum: number("9007199254740993"),
        },
      },
    };
  d.paths["/test"].post.requestBody = {
    required: true,
    content: { "application/json": { schema: s } },
  };
  d.paths["/test"].post.responses[200] = {
    description: "id",
    content: { "application/json": { schema: s } },
  };
  const f = await serve(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString();
    res.writeHead(200, { "content-type": "application/json" }).end(raw);
  });
  try {
    await use(
      d,
      async (e) => {
        const p = await e.plan(),
          t = p.cases.find((c) => !c.negative);
        assert.equal(compare(t.body.id, number("9007199254740993")), 0);
        assert.equal((await e.validateRequest(t)).valid, true);
        const r = await e.run(f.base);
        assert.ok(r.records.some((r) => !r.negative && r.passed));
      },
      { allowWrite: true },
    );
  } finally {
    await f.close();
  }
});
test("TRACE transport and XML echo work end to end without fetch restrictions", async () => {
  const d = doc();
  d.paths["/trace"] = {
    trace: { operationId: "trace", responses: { 200: ack } },
  };
  const s = {
    type: "object",
    xml: { name: "quote" },
    required: ["price"],
    properties: { price: { type: "integer", enum: [7] } },
  };
  d.paths["/test"].post.requestBody = {
    required: true,
    content: { "application/xml": { schema: s } },
  };
  d.paths["/test"].post.responses[200] = {
    description: "xml",
    content: { "application/xml": { schema: s } },
  };
  let traced = false;
  const f = await serve(async (req, res) => {
    if (req.method === "TRACE") {
      traced = true;
      res.writeHead(200).end();
      return;
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let valid;
    try {
      valid = validSchema(s, decodeXML(s, Buffer.concat(chunks).toString()));
    } catch {
      valid = false;
    }
    if (!valid) {
      res.writeHead(400).end();
      return;
    }
    res
      .writeHead(200, { "content-type": "application/xml" })
      .end(Buffer.concat(chunks));
  });
  try {
    await use(
      d,
      async (e) => {
        const r = await e.run(f.base);
        assert.deepEqual(r.blockers, []);
        assert.ok(r.passed, JSON.stringify(r));
        assert.ok(traced);
      },
      { allowWrite: true },
    );
  } finally {
    await f.close();
  }
});
test("Links follow response IDs using operationRef, qualified parameters and explicit permission", async () => {
  const d = doc();
  d.paths = {
    "/start": {
      get: {
        operationId: "start",
        responses: {
          200: {
            description: "created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { id: { type: "integer" } },
                },
              },
            },
            links: {
              next: {
                operationRef: "#/paths/~1item~1%7Bid%7D/get",
                parameters: { "path.id": "$response.body#/id" },
              },
            },
          },
        },
      },
    },
    "/item/{id}": {
      get: {
        operationId: "item",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer", minimum: 1 },
          },
        ],
        responses: { 200: ack },
      },
    },
  };
  d.paths["/item/{id}"].get.responses[400] = ack;
  const paths = [];
  const f = await serve((req, res) => {
    paths.push(req.url);
    if (req.url === "/start")
      res
        .writeHead(200, { "content-type": "application/json" })
        .end('{"id":42}');
    else res.writeHead(Number(req.url.split("/").at(-1)) < 1 ? 400 : 200).end();
  });
  try {
    await use(
      d,
      async (e) => {
        const r = await e.run(f.base);
        assert.ok(r.passed, JSON.stringify(r));
        assert.ok(paths.includes("/item/42"));
        assert.ok(r.records.some((r) => r.case_id.startsWith("link-")));
      },
      { followLinks: true },
    );
  } finally {
    await f.close();
  }
});
test("Callbacks validate an owned receiver, detect schema faults and never leak its URL", async () => {
  for (const bad of [false, true]) {
    const d = doc();
    d.paths["/test"].post.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["url"],
            properties: {
              url: {
                type: "string",
                format: "uri",
                example: "http://127.0.0.1/placeholder",
              },
            },
          },
        },
      },
    };
    d.paths["/test"].post.callbacks = {
      done: {
        "{$request.body#/url}": {
          post: {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["ok"],
                    properties: { ok: { type: "boolean" } },
                  },
                },
              },
            },
            responses: { 200: ack },
          },
        },
      },
    };
    let requests = 0;
    const f = await serve(async (req, res) => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks));
      } catch {
        res.writeHead(400).end();
        return;
      }
      if (!body?.url || !body.url.includes("127.0.0.1:")) {
        res.writeHead(400).end();
        return;
      }
      requests++;
      await fetch(body.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: bad ? "wrong" : true }),
      });
      res.writeHead(200).end();
    });
    try {
      await use(
        d,
        async (e) => {
          const r = await e.run(f.base);
          assert.ok(requests > 0);
          assert.ok(
            r.records.some(
              (r) => r.callback_count === 1 && r.callbacks_valid === !bad,
            ),
          );
          assert.equal(r.passed, !bad, JSON.stringify(r));
          assert.doesNotMatch(JSON.stringify(r), /http:\/\/127|placeholder/);
        },
        { allowWrite: true, allowCallbacks: true, callbackTimeout: 200 },
      );
    } finally {
      await f.close();
    }
  }
});
test("external operationRef resolves granted OAD, parameters and relative refs without network", async () => {
  const d = doc();
  d.paths["/test"].post.responses[200] = {
    description: "link",
    links: {
      remote: {
        operationRef: "https://granted.invalid/external.yaml#/paths/~1next/get",
        parameters: { "query.id": "$response.body#/id" },
      },
    },
  };
  const external = {
    openapi: "3.0.4",
    info: { title: "external owned schema", version: "1" },
    paths: {
      "/next": {
        get: {
          parameters: [
            {
              name: "id",
              in: "query",
              required: true,
              schema: { $ref: "#/components/schemas/ID" },
            },
          ],
          responses: { 200: ack },
        },
      },
    },
    components: { schemas: { ID: { type: "integer", format: "int64" } } },
  };
  await use(
    d,
    async (e) => {
      const [link] = await e.resolveLinks("test", {
        status: 200,
        response: { body: { id: number("9007199254740993") } },
      });
      assert.ok(link.valid, JSON.stringify(link));
      assert.equal(link.operation.path, "/next");
      assert.equal(String(link.test.parameters[0].value), "9007199254740993");
    },
    {
      documents: {
        "https://granted.invalid/external.yaml": stringifyExact(external),
      },
    },
  );
});
test("exact enum document validation, YAML core numeric syntax, refs and ignored siblings", async () => {
  const d = doc();
  d.components = {
    schemas: {
      ID: {
        type: "integer",
        format: "int64",
        enum: [number("9007199254740992"), number("9007199254740993")],
      },
    },
  };
  d.paths["/test"].post.requestBody = {
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/ID", type: "boolean" },
      },
    },
  };
  await use(d, async (e) => {
    assert.equal(
      (
        await e.validateRequest({
          operation_id: "test",
          parameters: [],
          media: "application/json",
          body: number("9007199254740993"),
        })
      ).valid,
      true,
    );
  });
  const source =
    'openapi: 3.0.4\ninfo: {title: YAML numbers, version: "1"}\npaths: {}\ncomponents:\n  schemas:\n    N: {type: number, minimum: 0x10, maximum: 2.0e1, default: +16}\n';
  await use(source, async (e) =>
    assert.equal(e.description.document_valid, true),
  );
});
test("all component categories, extensions and metadata remain legal, unused constraints are audited", async () => {
  const d = doc();
  d.tags = [
    {
      name: "t",
      description: "tag",
      externalDocs: { url: "https://docs.invalid/" },
    },
  ];
  d.externalDocs = { url: "https://docs.invalid/" };
  d.paths["x-opaque"] = { get: "not an operation", $ref: "file:///never-read" };
  d["x-data"] = { enum: [1, 1], constructor: "metadata" };
  d.components = {
    schemas: { S: { type: "string" } },
    parameters: {
      P: { name: "q", in: "query", schema: { $ref: "#/components/schemas/S" } },
    },
    headers: { H: { schema: { type: "integer" } } },
    examples: { E: { value: { schema: { enum: [1, 1] } } } },
    requestBodies: {
      B: {
        content: {
          "text/plain": { schema: { $ref: "#/components/schemas/S" } },
        },
      },
    },
    responses: {
      R: {
        description: "response",
        headers: { "x-n": { $ref: "#/components/headers/H" } },
      },
    },
    links: { L: { operationId: "test" } },
    callbacks: {
      C: { "{$request.query.url}": { post: { responses: { 200: ack } } } },
    },
    securitySchemes: { S: { type: "http", scheme: "bearer" } },
  };
  await use(d, async (e) => assert.equal(e.description.document_valid, true));
  d.components.schemas.Broken = { type: "string", pattern: "[" };
  await assert.rejects(
    StandardEngine.open(stringifyExact(d)),
    /STANDARD_SCHEMA_PATTERN/,
  );
});
test("callbacks enforce AND OR authentication including prototype-named schemes", async () => {
  const d = doc();
  d.components = {
    securitySchemes: parseExact(
      '{"constructor":{"type":"apiKey","in":"header","name":"x-token"}}',
    ),
  };
  d.paths["/test"].post.callbacks = {
    done: {
      "{$request.query.url}": {
        post: {
          security: [{ constructor: [] }],
          requestBody: {
            content: { "text/plain": { schema: { type: "string" } } },
          },
          responses: { 200: ack },
        },
      },
    },
  };
  for (const credentials of [
    {},
    parseExact('{"constructor":{"value":"synthetic-token"}}'),
  ])
    await use(
      d,
      async (e) => {
        const incoming = {
          method: "POST",
          url: "/owned",
          headers: { "content-type": "text/plain" },
          raw: Buffer.from("ok").toString("base64"),
        };
        assert.equal(
          (
            await e.validateCallback(
              "test",
              "done",
              "{$request.query.url}",
              incoming,
            )
          ).status,
          401,
        );
        incoming.headers["x-token"] = "synthetic-token";
        assert.equal(
          (
            await e.validateCallback(
              "test",
              "done",
              "{$request.query.url}",
              incoming,
            )
          ).valid,
          Object.hasOwn(credentials, "constructor"),
        );
      },
      { credentials },
    );
});
test("XML default namespaces reset children and composed alternative XML selects valid branch", () => {
  const s = {
      type: "object",
      xml: { name: "root", namespace: "urn:root" },
      properties: { a: { type: "string" } },
    },
    v = { a: "test" };
  assert.ok(equal(decodeXML(s, encodeXML(s, v)), v));
  const c = {
    oneOf: [
      {
        type: "object",
        xml: { name: "cat" },
        properties: { meow: { type: "boolean" } },
        required: ["meow"],
      },
      {
        type: "object",
        xml: { name: "dog" },
        properties: { bark: { type: "integer" } },
        required: ["bark"],
      },
    ],
  };
  assert.deepEqual(decodeXML(c, "<dog><bark>3</bark></dog>"), { bark: 3 });
});
test("parameter content ignores styles, all reversible defined wire styles round-trip", () => {
  for (const style of ["simple", "label", "matrix"])
    for (const explode of [false, true])
      for (const value of [[3, 4], { a: 3, b: 4 }]) {
        const schema = Array.isArray(value)
          ? { type: "array", items: { type: "integer" } }
          : {
              type: "object",
              properties: { a: { type: "integer" }, b: { type: "integer" } },
            };
        const p = { name: "id", in: "path", style, explode, schema },
          encoded = serializeParameter(p, value);
        assert.deepEqual(
          deserializeParameter(p, { path: { id: encoded } }),
          value,
        );
      }
  const p = {
      name: "body",
      in: "query",
      style: "deepObject",
      content: "application/xml",
      schema: {
        type: "object",
        xml: { name: "item" },
        properties: { n: { type: "integer" } },
      },
    },
    v = { n: 4 };
  assert.deepEqual(
    deserializeParameter(p, { query: serializeParameter(p, v).join("&") }),
    v,
  );
});
test("arbitrary media have explicit trusted codec extension points, not implicit schema coercion", async () => {
  const d = doc(),
    s = {
      type: "object",
      required: ["ok"],
      properties: { ok: { type: "boolean" } },
    };
  d.paths["/test"].post.responses[200] = {
    description: "opaque media",
    content: { "application/x-owned-codec": { schema: s } },
  };
  const f = await serve((req, res) =>
    res
      .writeHead(200, { "content-type": "application/x-owned-codec" })
      .end(Buffer.from([1])),
  );
  try {
    await use(
      d,
      async (e) => {
        const r = await e.run(f.base);
        assert.ok(r.passed, JSON.stringify(r));
      },
      {
        allowWrite: true,
        codecs: {
          "application/x-owned-codec": {
            encode: () => Buffer.from([1]),
            decode: (bytes) => ({ ok: bytes[0] === 1 }),
          },
        },
      },
    );
  } finally {
    await f.close();
  }
});
test("wildcard request/response media, XML content headers, HEAD and empty undeclared media body", async () => {
  const d = doc();
  d.paths["/test"].post.requestBody = {
    required: true,
    content: {
      "application/*": { schema: { type: "string", enum: ["hello"] } },
    },
  };
  d.paths["/test"].post.responses[200] = {
    description: "wildcard",
    headers: {
      "x-data": {
        content: {
          "application/xml": {
            schema: {
              type: "object",
              xml: { name: "root" },
              properties: { ok: { type: "boolean" } },
            },
          },
        },
      },
    },
    content: { "*/*": { schema: { type: "string" } } },
  };
  const f = await serve(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    if (raw !== "hello") {
      res.writeHead(400).end();
      return;
    }
    res
      .writeHead(200, {
        "content-type": "text/plain",
        "x-data": "<root><ok>true</ok></root>",
      })
      .end("yes");
  });
  try {
    await use(
      d,
      async (e) => {
        const r = await e.run(f.base);
        assert.ok(r.passed, JSON.stringify(r));
      },
      { allowWrite: true },
    );
  } finally {
    await f.close();
  }
});
test("form defaults and explicit RFC6570 strategies, nullable and base64 round-trip", () => {
  const schema = {
    type: "object",
    properties: {
      object: { type: "object", properties: { id: { type: "integer" } } },
      array: { type: "array", items: { type: "string" } },
      byte: { type: "string", format: "byte" },
      binary: { type: "string", format: "binary" },
      nil: { type: "integer", nullable: true },
    },
  };
  const value = {
    object: { id: 7 },
    array: ["red", "blue"],
    byte: "AP8=",
    binary: "\0\xff",
    nil: null,
  };
  const w = encodeMedia("application/x-www-form-urlencoded", value, { schema });
  assert.ok(equal(decodeMedia(w.contentType, w.body, { schema }), value));
  for (const e of [
    { style: "form", explode: true },
    { style: "deepObject", explode: true },
    { style: "form", explode: false },
  ]) {
    const c = {
        schema: {
          type: "object",
          properties: { object: schema.properties.object },
        },
        encoding: { object: e },
      },
      v = { object: { id: 7 } },
      f = encodeMedia("application/x-www-form-urlencoded", v, c);
    assert.deepEqual(decodeMedia(f.contentType, f.body, c), v);
  }
  const m = encodeMedia(
    "multipart/form-data",
    { byte: "AP8=" },
    {
      schema: { type: "object", properties: { byte: schema.properties.byte } },
      encoding: { byte: { contentType: "image/png", style: "form" } },
    },
  );
  assert.deepEqual(
    decodeMedia(m.contentType, m.body, {
      schema: { type: "object", properties: { byte: schema.properties.byte } },
      encoding: { byte: { contentType: "image/png" } },
    }),
    { byte: "AP8=" },
  );
});
test("callback contracts cover content parameters, typed response headers, empty text and response direction", async () => {
  const d = doc();
  const response = {
    description: "callback response",
    headers: {
      "x-result": {
        required: true,
        schema: { type: "array", items: { type: "integer" }, example: [1, 2] },
      },
    },
    content: {
      "application/json": {
        schema: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "integer", readOnly: true, enum: [7] } },
        },
      },
    },
  };
  const post = {
    parameters: [
      {
        name: "filter",
        in: "query",
        required: true,
        style: "deepObject",
        explode: true,
        schema: {
          type: "object",
          properties: { id: { type: "integer" } },
          required: ["id"],
        },
      },
    ],
    requestBody: {
      required: true,
      content: { "text/plain": { schema: { type: "string" } } },
    },
    responses: { 200: response },
  };
  d.paths["/test"].post.callbacks = {
    result: { "{$request.query.url}": { post } },
  };
  await use(d, async (e) => {
    const incoming = {
        method: "POST",
        url: "/owned?filter[id]=3",
        headers: { "content-type": "text/plain" },
        raw: "",
      },
      r = await e.validateCallback(
        "test",
        "result",
        "{$request.query.url}",
        incoming,
      );
    assert.ok(r.valid, JSON.stringify(r));
    assert.equal(r.headers["x-result"], "1,2");
    assert.deepEqual(parseExact(Buffer.from(r.body, "base64").toString()), {
      id: 7,
    });
    incoming.url = "/owned?filter[id]=wrong";
    assert.equal(
      (
        await e.validateCallback(
          "test",
          "result",
          "{$request.query.url}",
          incoming,
        )
      ).valid,
      false,
    );
  });
});
test("callback timeout and link depth budgets are inconclusive, never successful coverage", async () => {
  const d = doc();
  d.paths["/test"].post.requestBody = {
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties: {
            url: { type: "string", example: "http://127.0.0.1/owned" },
          },
        },
      },
    },
  };
  d.paths["/test"].post.callbacks = {
    missing: { "{$request.body#/url}": { post: { responses: { 200: ack } } } },
  };
  const f = await serve((req, res) => {
    req.resume();
    res.writeHead(200).end();
  });
  try {
    await use(
      d,
      async (e) => {
        const r = await e.run(f.base);
        assert.equal(r.passed, false);
        assert.ok(
          r.records.some((r) => r.code === "callback_contract_or_timeout"),
        );
      },
      { allowWrite: true, allowCallbacks: true, callbackTimeout: 20 },
    );
  } finally {
    await f.close();
  }
});
test("file and non-network absolute URI reference grants never enable ambient filesystem reads", async () => {
  for (const uri of [
    "file:///not-granted/schema.json",
    "urn:moonapi:synthetic-schema",
  ]) {
    const d = doc();
    d.paths["/test"].post.requestBody = {
      content: { "application/json": { schema: { $ref: uri + "#/S" } } },
    };
    await use(
      d,
      async (e) => {
        assert.deepEqual((await e.plan()).blockers, []);
      },
      { documents: { [uri]: '{"S":{"type":"integer","enum":[7]}}' } },
    );
    await assert.rejects(
      StandardEngine.open(stringifyExact(d)),
      /STANDARD_REFERENCE_NOT_GRANTED/,
    );
  }
});
test("literal business $ref in examples defaults enum and extensions is data, header references remain references", async () => {
  const literal = {
      $ref: "file:///never-read-private-file",
      constructor: "business",
    },
    d = doc();
  d.paths["/test"].post.requestBody = {
    content: {
      "application/json": {
        schema: {
          type: "object",
          example: literal,
          default: literal,
          enum: [literal],
        },
        examples: { one: { value: literal } },
      },
    },
  };
  d["x-business"] = literal;
  d.components = { headers: { H: { schema: { type: "integer" } } } };
  d.paths["/test"].post.responses[200] = {
    description: "ref header",
    headers: { "x-id": { $ref: "#/components/headers/H" } },
  };
  await use(d, async (e) => {
    assert.deepEqual((await e.plan()).blockers, []);
    const plan = await e.plan();
    assert.equal(plan.cases.find((t) => !t.negative).body.$ref, literal.$ref);
  });
});
test("XML inherited prefixes and repeated namespaced attributes produce well-formed output", () => {
  const schema = {
      type: "object",
      xml: { name: "root", prefix: "p", namespace: "urn:p" },
      required: ["empty"],
      properties: {
        a: { type: "integer", xml: { attribute: true, prefix: "p" } },
        b: { type: "integer", xml: { attribute: true, prefix: "p" } },
        c: { type: "string", xml: { attribute: true, namespace: "urn:other" } },
        child: { type: "string", xml: { prefix: "p" } },
        empty: { type: "array", items: { type: "string" } },
      },
    },
    value = { a: 1, b: 2, c: "x", child: "yes", empty: [] };
  const wire = encodeXML(schema, value);
  assert.equal((wire.match(/xmlns:p/g) || []).length, 2);
  assert.deepEqual(decodeXML(schema, wire), value);
});
test("finite structural shadows never narrow arbitrary-precision schema bounds or counts", async () => {
  for (const schema of [
    { type: "number", minimum: number("1e400") },
    { type: "number", multipleOf: number("1e-400") },
    { type: "array", minItems: number("1e400"), items: { type: "string" } },
  ]) {
    const d = doc();
    d.components = { schemas: { Wide: schema } };
    await use(d, (e) => assert.equal(e.description.document_valid, true));
  }
  const d = doc();
  d.components = {
    schemas: {
      Bad: { type: "string", maxLength: number("1.00000000000000000000001") },
    },
  };
  await assert.rejects(
    StandardEngine.open(stringifyExact(d)),
    /STANDARD_SCHEMA_COUNT/,
  );
});
test("normative delimiter encoding and null matrix values cannot be ambiguous path/query syntax", () => {
  assert.equal(
    serializeParameter({ name: "id", in: "path", style: "matrix" }, null),
    ";id",
  );
  assert.equal(
    serializeParameter({ name: "id", in: "path", style: "matrix" }, ""),
    ";id=",
  );
  assert.deepEqual(
    serializeParameter(
      { name: "q", in: "query", style: "pipeDelimited" },
      [1, 2],
    ),
    ["q=1%7C2"],
  );
  assert.deepEqual(
    serializeParameter(
      { name: "q", in: "query", style: "deepObject" },
      { a: 1 },
    ),
    ["q%5Ba%5D=1"],
  );
  const p = {
      name: "id",
      in: "path",
      style: "label",
      explode: true,
      schema: { type: "array", items: { type: "string" } },
    },
    value = ["a.b", "c.d"];
  assert.deepEqual(
    deserializeParameter(p, { path: { id: serializeParameter(p, value) } }),
    value,
  );
});
test("nullable path values and empty collections follow explicit reversible policies", () => {
  for (const style of ["simple", "matrix", "label"])
    for (const type of ["string", "integer", "array", "object"]) {
      const p = {
        name: "id",
        in: "path",
        style,
        schema: { type, nullable: true },
      };
      assert.equal(
        deserializeParameter(p, { path: { id: serializeParameter(p, null) } }),
        null,
      );
    }
  const schema = {
      type: "object",
      properties: { file: { type: "string", format: "binary" } },
    },
    content = {
      schema,
      encoding: {
        file: {
          headers: {
            "Content-Disposition": {
              example: 'form-data; name="file"; filename="owned.bin"',
            },
          },
        },
      },
    };
  const wire = encodeMedia("multipart/form-data", { file: "data" }, content);
  assert.equal(
    (wire.body.toString().match(/Content-Disposition:/g) || []).length,
    1,
  );
  assert.deepEqual(decodeMedia(wire.contentType, wire.body, content), {
    file: "data",
  });
});
test("x-prefixed component, header and callback names are not mistaken for extension data", async () => {
  const d = doc();
  d.components = {
    callbacks: {
      "x-notify": {
        "{$request.query.url}": { post: { responses: { 200: ack } } },
      },
    },
    headers: { "x-header": { schema: { type: "integer" } } },
  };
  d.paths["/test"].post.callbacks = {
    "x-callback": { $ref: "#/components/callbacks/x-notify" },
  };
  d.paths["/test"].post.responses[200] = {
    description: "named ref",
    headers: { "x-response": { $ref: "#/components/headers/x-header" } },
  };
  await use(d, async (e) => {
    assert.equal(e.description.document_valid, true);
    assert.deepEqual(e.description.operations[0].callbacks, ["x-callback"]);
  });
});
test("whole runtime pointers may contain braces; missing metadata is absent, $-prefixed literals remain literals", async () => {
  assert.equal(
    expression("$request.body#/a{b}", { request: { body: { "a{b}": 7 } } }),
    7,
  );
  assert.equal(expression("$statusCode", {}), undefined);
  const d = doc();
  d.paths["/test"].post.responses[200] = {
    description: "link",
    links: { literal: { operationId: "next", requestBody: "$price" } },
  };
  d.paths["/next"] = {
    post: {
      operationId: "next",
      requestBody: {
        content: { "text/plain": { schema: { type: "string" } } },
      },
      responses: { 200: ack },
    },
  };
  await use(d, async (e) => {
    const [link] = await e.resolveLinks("test", { status: 200 });
    assert.equal(link.test.body, "$price");
    assert.ok(link.valid);
  });
});
test("linked compile errors preserve exactly one executed record and a blocked verdict", async () => {
  const d = doc();
  d.paths["/test"].post.responses[200] = {
    description: "link",
    links: {
      external: {
        operationRef: "https://granted.invalid/external.json#/paths/~1next/get",
      },
    },
  };
  const extra = doc();
  extra.paths = {
    "/next": {
      get: {
        responses: {
          200: {
            description: "broken grant",
            content: {
              "application/json": {
                schema: { $ref: "https://not-granted.invalid/schema" },
              },
            },
          },
        },
      },
    },
  };
  const f = await serve((req, res) => {
    req.resume();
    res.writeHead(200).end();
  });
  try {
    await use(
      d,
      async (e) => {
        const r = await e.run(f.base);
        assert.equal(r.executed, 1);
        assert.equal(r.records.length, 1);
        assert.equal(r.passed, false);
        assert.ok(r.blockers.some((b) => b.code === "link_resolution_blocked"));
      },
      {
        allowWrite: true,
        followLinks: true,
        documents: {
          "https://granted.invalid/external.json": stringifyExact(extra),
        },
      },
    );
  } finally {
    await f.close();
  }
});
test("negative cases with valid callback addresses are rebound too, never forwarded to an external example", async () => {
  const d = doc();
  d.paths["/test"].post.requestBody = {
    required: true,
    content: {
      "application/json": {
        schema: {
          type: "object",
          required: ["url", "qty"],
          properties: {
            url: {
              type: "string",
              format: "uri",
              example: "https://external-example.invalid/notify",
            },
            qty: { type: "integer", minimum: 1, maximum: 1 },
          },
        },
      },
    },
  };
  d.paths["/test"].post.callbacks = {
    done: { "{$request.body#/url}": { post: { responses: { 200: ack } } } },
  };
  const seen = [];
  const f = await serve(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    let v;
    try {
      v = JSON.parse(raw);
    } catch {}
    if (v?.url) seen.push(v.url);
    if (v?.qty !== 1 || !/^http:\/\/127\.0\.0\.1:\d+\//.test(v?.url || "")) {
      res.writeHead(400).end();
      return;
    }
    await fetch(v.url, { method: "POST" });
    res.writeHead(200).end();
  });
  try {
    await use(
      d,
      async (e) => {
        const r = await e.run(f.base);
        assert.ok(r.passed, JSON.stringify(r));
        assert.ok(seen.length > 1);
        assert.ok(
          seen.every((url) => !url.includes("external-example.invalid")),
        );
      },
      { allowWrite: true, allowCallbacks: true, callbackTimeout: 100 },
    );
  } finally {
    await f.close();
  }
});

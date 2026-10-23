import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { StandardEngine } from "../platform/standard.mjs";
import {
  serializeParameter,
  encodeRequest,
  resolveServer,
} from "../platform/standard-codec.mjs";

const schema = {
  type: "object",
  required: ["ok"],
  properties: { ok: { type: "boolean" } },
  additionalProperties: false,
};
const response = {
  description: "Synthetic response",
  content: { "application/json": { schema } },
};
export function document() {
  return structuredClone({
    openapi: "3.0.3",
    info: { title: "Synthetic standard regression", version: "1" },
    paths: {
      "/quote": {
        post: {
          operationId: "quote",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    {
                      type: "object",
                      required: ["quantity"],
                      properties: {
                        quantity: {
                          type: "integer",
                          minimum: 1,
                          maximum: 10,
                          multipleOf: 1,
                        },
                      },
                    },
                    {
                      type: "object",
                      required: ["sku"],
                      properties: {
                        sku: {
                          type: "string",
                          pattern: "^[A-Z]{3}$",
                          minLength: 3,
                          maxLength: 3,
                        },
                      },
                    },
                  ],
                  example: { quantity: 2, sku: "ABC" },
                },
              },
            },
          },
          responses: { "2XX": response, 400: response },
        },
      },
      "/search": {
        get: {
          operationId: "search",
          parameters: [
            {
              name: "tags",
              in: "query",
              required: true,
              style: "form",
              explode: true,
              schema: {
                type: "array",
                minItems: 1,
                maxItems: 2,
                uniqueItems: true,
                items: { type: "string", enum: ["blue", "red"] },
              },
            },
            {
              name: "x-client",
              in: "header",
              required: true,
              schema: { type: "string", enum: ["synthetic"] },
            },
            {
              name: "session",
              in: "cookie",
              required: true,
              schema: { type: "string", enum: ["fixture"] },
            },
          ],
          responses: {
            200: {
              ...response,
              headers: {
                "x-count": {
                  required: true,
                  schema: { type: "integer", minimum: 1 },
                },
              },
            },
            400: response,
          },
        },
      },
    },
  });
}
async function withEngine(doc, fn, options) {
  const engine = await StandardEngine.open(JSON.stringify(doc), options);
  try {
    return await fn(engine);
  } finally {
    await engine.close();
  }
}
test("standard plan accepts composition regex arrays header cookie and status ranges", async () => {
  await withEngine(document(), async (engine) => {
    const plan = await engine.plan();
    assert.deepEqual(plan.blockers, []);
    assert.ok(
      plan.cases.some((c) => c.operation_id === "quote" && !c.negative),
    );
    assert.ok(
      plan.cases.some((c) => c.operation_id === "search" && c.negative),
    );
    assert.ok(
      plan.cases.some(
        (c) =>
          c.operation_id === "quote" && c.body?.quantity === 10 && !c.negative,
      ),
    );
    assert.ok(
      plan.cases.some(
        (c) =>
          c.operation_id === "quote" && c.body?.quantity === 11 && c.negative,
      ),
    );
    for (const c of plan.cases)
      assert.equal((await engine.validateRequest(c)).valid, !c.negative);
    assert.equal(plan.full_openapi_support, true);
    assert.deepEqual(await engine.plan(), plan);
  });
});
test("contract verifies oneOf anyOf not dictionaries formats and direction", async () => {
  const d = document();
  d.paths["/quote"].post.requestBody.content["application/json"].schema = {
    type: "object",
    required: ["choice", "dictionary", "date"],
    properties: {
      choice: {
        oneOf: [
          { type: "integer", minimum: 1 },
          { type: "string", minLength: 1 },
        ],
      },
      dictionary: {
        type: "object",
        additionalProperties: {
          anyOf: [{ type: "number", minimum: 0 }, { type: "boolean" }],
        },
      },
      date: { type: "string", format: "date" },
      denied: { not: { type: "string" } },
      id: { type: "integer", readOnly: true },
    },
  };
  await withEngine(d, async (engine) => {
    const base = {
      operation_id: "quote",
      parameters: [],
      media: "application/json",
      body: { choice: 1, dictionary: { a: true }, date: "2026-10-23" },
    };
    assert.equal((await engine.validateRequest(base)).valid, true);
    for (const mutation of [
      { choice: null },
      { dictionary: { a: "no" } },
      { date: "not-a-date" },
      { denied: "no" },
    ])
      assert.equal(
        (
          await engine.validateRequest({
            ...base,
            body: { ...base.body, ...mutation },
          })
        ).valid,
        false,
        JSON.stringify(mutation),
      );
  });
});
test("response validates ranges media required headers and schema", async () => {
  await withEngine(document(), async (engine) => {
    assert.equal(
      (
        await engine.validateResponse(
          "quote",
          201,
          { ok: true },
          { "Content-Type": "application/json" },
        )
      ).valid,
      true,
    );
    assert.equal(
      (
        await engine.validateResponse(
          "quote",
          201,
          { ok: "not-bool" },
          { "content-type": "application/json" },
        )
      ).valid,
      false,
    );
    assert.equal(
      (
        await engine.validateResponse(
          "quote",
          201,
          { ok: true },
          { "content-type": "text/plain" },
        )
      ).valid,
      false,
    );
    assert.equal(
      (
        await engine.validateResponse(
          "search",
          200,
          { ok: true },
          { "content-type": "application/json" },
        )
      ).code,
      "response_header_missing",
    );
    assert.equal(
      (
        await engine.validateResponse(
          "search",
          200,
          { ok: true },
          { "content-type": "application/json", "x-count": "2" },
        )
      ).valid,
      true,
    );
    assert.equal(
      (
        await engine.validateResponse(
          "search",
          200,
          { ok: true },
          { "content-type": "application/json", "x-count": "bad" },
        )
      ).valid,
      false,
    );
  });
});
test("structural invalidity and duplicate semantic declarations are rejected", async () => {
  for (const mutate of [
    (d) => delete d.info,
    (d) => delete d.paths["/quote"].post.responses[400].description,
    (d) =>
      d.paths["/search"].get.parameters.push(
        d.paths["/search"].get.parameters[0],
      ),
    (d) => (d.paths["/search"].get.operationId = "quote"),
  ]) {
    const d = document();
    mutate(d);
    await assert.rejects(StandardEngine.open(JSON.stringify(d)), /STANDARD_/);
  }
});
test("explicit external reference grants resolve without ambient file or network reads", async () => {
  const d = document();
  d.paths["/quote"].post.requestBody.content["application/json"].schema = {
    $ref: "https://fixture.invalid/models.json#/Quote",
  };
  await assert.rejects(StandardEngine.open(JSON.stringify(d)), /STANDARD_/);
  await withEngine(
    d,
    async (engine) => {
      const plan = await engine.plan();
      assert.deepEqual(plan.blockers, []);
    },
    {
      documents: {
        "https://fixture.invalid/models.json": JSON.stringify({
          Quote: { type: "integer", minimum: 0 },
        }),
      },
    },
  );
  d.paths["/quote"].post.requestBody.content["application/json"].schema.$ref =
    "file:///C:/private.json";
  await assert.rejects(StandardEngine.open(JSON.stringify(d)), /STANDARD_/);
});
test("Links and Callbacks compile without feature blockers but do not imply execution coverage", async () => {
  const d = document();
  d.paths["/quote"].post.responses[400].links = {
    next: { operationId: "search" },
  };
  d.paths["/quote"].post.callbacks = {
    callback: {
      "{$request.body#/url}": {
        post: {
          requestBody: { content: { "application/json": { schema } } },
          responses: { 200: { description: "ack" } },
        },
      },
    },
  };
  await withEngine(d, async (engine) => {
    const plan = await engine.plan();
    assert.deepEqual(plan.blockers, []);
    assert.ok(
      engine.description.operations.some((o) =>
        o.callbacks.includes("callback"),
      ),
    );
    assert.equal(plan.full_openapi_support, true);
  });
});
test("OAS style serialization preserves tokens and required separators", () => {
  const param = (location, style, explode, value) =>
    serializeParameter({ name: "id", in: location, style, explode }, value);
  assert.equal(param("path", "simple", false, [3, 4]), "3,4");
  assert.equal(param("path", "label", true, [3, 4]), ".3.4");
  assert.equal(
    param("path", "matrix", true, { role: "admin", name: "a/b" }),
    ";role=admin;name=a%2Fb",
  );
  assert.deepEqual(param("query", "form", true, [3, 4]), ["id=3", "id=4"]);
  assert.deepEqual(param("query", "deepObject", true, { role: "a b" }), [
    "id%5Brole%5D=a%20b",
  ]);
  assert.deepEqual(param("query", "spaceDelimited", false, [3, 4]), [
    "id=3%204",
  ]);
  assert.deepEqual(param("query", "pipeDelimited", false, [3, 4]), [
    "id=3%7C4",
  ]);
  assert.deepEqual(param("header", "simple", true, { role: "admin" }), [
    "id",
    "role=admin",
  ]);
  assert.deepEqual(param("cookie", "form", false, [3, 4]), ["id=3,4"]);
});
test("serialization refuses header injection dot segments and unbound templates", () => {
  assert.throws(() =>
    serializeParameter({ name: "x-test", in: "header" }, "a\r\nb: c"),
  );
  assert.throws(() =>
    encodeRequest({ path: "/{id}", parameters: [] }, { parameters: [] }),
  );
  assert.throws(() =>
    encodeRequest(
      { path: "/{id}", parameters: [{ name: "id", in: "path" }] },
      { parameters: [{ name: "id", in: "path", value: ".." }] },
    ),
  );
  assert.deepEqual(
    serializeParameter(
      { name: "q", in: "query", allowReserved: true },
      "a&b=1",
    ),
    ["q=a%26b%3D1"],
  );
});
test("server variables validate enum and do not automatically authorize remote targets", () => {
  const servers = [
    {
      url: "https://{region}.example.invalid/{version}",
      variables: {
        region: { default: "eu", enum: ["eu", "us"] },
        version: { default: "v1" },
      },
    },
  ];
  assert.equal(resolveServer(servers), "https://eu.example.invalid/v1");
  assert.throws(() => resolveServer(servers, 0, { region: "bad" }));
  assert.throws(() => resolveServer(servers, 0, { unknown: "x" }));
});
async function fixture(bug = false) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://fixture.invalid");
    let ok;
    if (url.pathname === "/search") {
      const tags = url.searchParams.getAll("tags");
      ok =
        tags.length > 0 &&
        tags.length <= 2 &&
        new Set(tags).size === tags.length &&
        tags.every((t) => ["blue", "red"].includes(t)) &&
        req.headers["x-client"] === "synthetic" &&
        req.headers.cookie?.includes("session=fixture");
      if (ok) res.setHeader("x-count", "2");
    } else {
      let raw = "";
      for await (const c of req) raw += c;
      let body;
      try {
        body = JSON.parse(raw);
      } catch {}
      ok =
        body &&
        Number.isInteger(body.quantity) &&
        body.quantity >= 1 &&
        body.quantity <= 10 &&
        typeof body.sku === "string" &&
        /^[A-Z]{3}$/.test(body.sku);
    }
    res.writeHead(ok ? 200 : 400, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ ok: bug && ok ? "deliberate-defect" : Boolean(ok) }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  };
}
test("non-CRUD HTTP tests detect deliberate contract faults and pass healthy control", async () => {
  for (const bug of [false, true]) {
    const f = await fixture(bug);
    try {
      await withEngine(
        document(),
        async (engine) => {
          const result = await engine.run(f.base);
          assert.equal(result.passed, !bug, JSON.stringify(result));
          assert.equal(result.executed, result.planned);
          assert.deepEqual(result.blockers, []);
          if (bug)
            assert.ok(
              result.records.some((r) => r.contract_code === "response_schema"),
            );
          assert.ok(!JSON.stringify(result).includes("synthetic"));
        },
        { allowWrite: true },
      );
    } finally {
      await f.close();
    }
  }
});
test("read-only policy and plan truncation cannot claim complete", async () => {
  const f = await fixture();
  try {
    await withEngine(document(), async (engine) => {
      const result = await engine.run(f.base);
      assert.equal(result.passed, false);
      assert.ok(result.blockers.some((b) => b.code === "write_not_authorized"));
    });
    await withEngine(
      document(),
      async (engine) => {
        const result = await engine.run(f.base);
        assert.equal(result.passed, false);
        assert.equal(result.truncated, true);
      },
      { limit: 1, allowWrite: true },
    );
  } finally {
    await f.close();
  }
});

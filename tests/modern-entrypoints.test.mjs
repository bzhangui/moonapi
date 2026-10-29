import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { inspectDialect } from "../platform/dialects.mjs";
import { startWorkbench } from "../platform/workbench-server.mjs";
import { capabilitiesFor } from "../platform/standard-capabilities.mjs";
import { contentKey } from "../platform/standard-content.mjs";
import { StandardEngine } from "../platform/standard.mjs";

const document = (version, paths, extra = {}) =>
  JSON.stringify({
    openapi: version,
    info: { title: "controlled native entrypoints", version: "1" },
    paths,
    ...extra,
  });
const response = {
  200: {
    description: "controlled response",
    content: {
      "application/json": {
        schema: {
          type: "object",
          required: ["ok"],
          properties: { ok: { const: true } },
          additionalProperties: false,
        },
      },
    },
  },
};
const post = (session, route, body, headers = {}) =>
  fetch(session.origin + "/api/" + route, {
    method: "POST",
    headers: {
      authorization: "Bearer " + session.token,
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
const forgedHost = (session, source) =>
  new Promise((resolve, reject) => {
    const target = new URL(session.origin);
    const request = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        method: "POST",
        path: "/api/check",
        headers: {
          host: "evil.invalid",
          authorization: "Bearer " + session.token,
          "content-type": "application/json",
        },
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      },
    );
    request.on("error", reject);
    request.end(JSON.stringify({ source }));
  });
async function status(session) {
  for (let i = 0; i < 200; i++) {
    const result = await (
      await fetch(session.origin + "/api/status", {
        headers: { authorization: "Bearer " + session.token },
      })
    ).json();
    if (result.state !== "running") return result;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("CONTROLLED_JOB_DEADLINE");
}

test("modern inspection eagerly validates unused native Schema roots and never resolves ambient resources", async () => {
  for (const version of ["3.1.2", "3.2.1"]) {
    const source = document(
      version,
      { "/ok": { get: { operationId: "read", responses: response } } },
      {
        components: {
          schemas: {
            Value: { type: ["string", "null"] },
            Exact: {
              type: "integer",
              minimum: 9223372036854775807n.toString(),
            },
          },
        },
      },
    );
    // A numeric keyword with a string value is invalid even when unused.
    const invalid = await inspectDialect(source);
    assert.equal(invalid.structurally_valid, false);
    const d = JSON.parse(source);
    d.components.schemas.Exact = { $ref: "https://private.invalid/secret" };
    const ungranted = await inspectDialect(JSON.stringify(d));
    assert.equal(ungranted.structurally_valid, false);
    assert.equal(JSON.stringify(ungranted).includes("private.invalid"), false);
    // Inspection and StandardEngine must agree on the default retrieval URI.
    d.components.schemas.Exact = {
      $ref: "https://moonapi.invalid/openapi.json#/components/schemas/Value",
    };
    const valid = await inspectDialect(JSON.stringify(d));
    assert.equal(valid.structurally_valid, true);
    assert.equal(valid.execution_supported, true);
    assert.equal(valid.modern_execution_supported, true);
    assert.equal(valid.modern_execution_validated, true);
    assert.equal(
      valid.full_openapi_support,
      capabilitiesFor(version).full_openapi_support,
    );
    assert.equal(valid.full_dialect_conformance_certified, false);
  }
  await assert.rejects(
    inspectDialect(document("4.0.0", {})),
    /DIALECT_INVALID_OR_UNGRANTED/,
  );
});

test("workbench check and inspect both compile native 3.1/3.2 and block invalid or future dialects without executing HTTP", async () => {
  const session = await startWorkbench({ port: 0 });
  try {
    for (const [index, version] of ["3.1.2", "3.2.1"].entries()) {
      const source = document(version, {
        "/ok": { get: { operationId: "read", responses: response } },
      });
      const result = await post(session, index ? "check" : "inspect", {
        source,
      });
      assert.equal(result.status, 200);
      const body = await result.json();
      assert.equal(body.execution_supported, true);
      assert.equal(body.dialect.version, version);
      assert.equal(body.dialect.modern_execution_validated, true);
      assert.ok(body.generated_cases > 0);
      assert.deepEqual(body.readonly_default, ["read"]);
      assert.deepEqual(
        body.operations.map((x) => x.id),
        ["read"],
      );
      const bad = JSON.parse(source);
      bad.components = { schemas: { Unused: { type: "not-a-json-type" } } };
      const blocked = await (
        await post(session, "check", { source: JSON.stringify(bad) })
      ).json();
      assert.equal(blocked.execution_supported, false);
      assert.equal(blocked.blocker, "INVALID_DOCUMENT_OR_SCHEMA");
      assert.deepEqual(blocked.operations, []);
    }
    const future = await (
      await post(session, "check", { source: document("4.0.0", {}) })
    ).json();
    assert.equal(future.execution_supported, false);
    assert.equal(future.blocker, "UNSUPPORTED_OPENAPI_VERSION");
    assert.deepEqual(future.operations, []);
  } finally {
    await session.close();
  }
});

test("native workbench read-only defaults select QUERY but never promote custom lowercase methods or write operations", async () => {
  const methods = [];
  const fixture = http.createServer((req, res) => {
    methods.push(req.method);
    req.resume();
    res
      .writeHead(200, { "content-type": "application/json" })
      .end('{"ok":true}');
  });
  await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  const session = await startWorkbench({ port: 0 });
  try {
    const source = document("3.2.1", {
      "/ok": {
        get: { operationId: "read", responses: response },
        query: { operationId: "search", responses: response },
        post: { operationId: "write", responses: response },
        additionalOperations: {
          get: { operationId: "custom", responses: response },
        },
      },
    });
    const inspected = await (await post(session, "check", { source })).json();
    assert.deepEqual(inspected.readonly_default, ["read", "search"]);
    const started = await post(session, "run", {
      source,
      base: `http://127.0.0.1:${fixture.address().port}`,
      mode: "contract",
    });
    assert.equal(started.status, 202);
    const completed = await status(session);
    assert.equal(completed.state, "finished", JSON.stringify(completed));
    assert.equal(completed.report.passed, true, JSON.stringify(completed));
    assert.ok(methods.includes("GET"));
    assert.ok(methods.includes("QUERY"));
    assert.equal(methods.includes("POST"), false);
    assert.equal(
      methods.some((x) => !["GET", "QUERY"].includes(x)),
      false,
    );
    assert.equal(JSON.stringify(completed).includes(session.token), false);
  } finally {
    await session.close();
    fixture.closeAllConnections();
    await new Promise((resolve) => fixture.close(resolve));
  }
});

test("modern check keeps session, CSRF, origin and startup write capabilities private and closed", async () => {
  const session = await startWorkbench({ port: 0 });
  const source = document("3.2.1", {
    "/ok": { get: { operationId: "read", responses: response } },
  });
  try {
    assert.equal((await fetch(session.origin + "/api/session")).status, 401);
    assert.equal(
      (
        await post(
          session,
          "check",
          { source },
          { origin: "https://evil.invalid" },
        )
      ).status,
      403,
    );
    assert.equal(await forgedHost(session, source), 403);
    assert.equal(
      (await fetch(session.origin + "/?session=" + session.token)).status,
      400,
    );
    assert.equal(
      (await post(session, "run", { source, allowWrite: true })).status,
      403,
    );
    assert.equal(
      (await post(session, "profile-save", { profile: { source } })).status,
      409,
    );
    const capability = await (
      await fetch(session.origin + "/api/session", {
        headers: { authorization: "Bearer " + session.token },
      })
    ).json();
    assert.equal(capability.write_capability, false);
    assert.equal(capability.remote_capability, false);
    assert.equal(capability.encrypted_profiles, false);
    assert.equal(JSON.stringify(capability).includes(session.token), false);
  } finally {
    await session.close();
  }
});

test("media range selection preserves quoted parameters, specificity and case-insensitive type tokens in native responses", async () => {
  const specific = 'APPLICATION/JSON; profile="a;b"; charset=utf-8';
  const choices = {
    "*/*": {},
    "application/*": {},
    "application/json": {},
    [specific]: {},
  };
  assert.equal(
    contentKey(
      choices,
      'application/json; charset=UTF-8; profile="a;b"; extra=yes',
    ),
    specific,
  );
  assert.equal(
    contentKey(choices, 'application/json; profile="different"'),
    "application/json",
  );
  assert.equal(contentKey(choices, "text/plain"), "*/*");
  assert.equal(contentKey({ [specific]: {} }, "application/json"), undefined);
  assert.equal(contentKey(choices, "malformed"), undefined);
  for (const version of ["3.1.2", "3.2.1"]) {
    const source = document(version, {
      "/ok": {
        get: {
          operationId: "read",
          responses: {
            200: {
              description: "controlled",
              content: {
                "application/json": { schema: false },
                [specific]: { schema: { const: { ok: true } } },
              },
            },
          },
        },
      },
    });
    const engine = await StandardEngine.open(source);
    try {
      assert.equal(
        (
          await engine.validateResponse(
            "read",
            200,
            { ok: true },
            {
              "content-type": 'application/json; profile="a;b"; charset=UTF-8',
            },
          )
        ).valid,
        true,
      );
      assert.equal(
        (
          await engine.validateResponse(
            "read",
            200,
            { ok: true },
            {
              "content-type":
                'application/json; profile="different"; charset=UTF-8',
            },
          )
        ).valid,
        false,
      );
    } finally {
      await engine.close();
    }
  }
});

test("itemSchema-only requests generate syntactically representable invalid items instead of only missing-body negatives", async () => {
  const source = document("3.2.1", {
    "/items": {
      post: {
        operationId: "items",
        requestBody: {
          required: true,
          content: {
            "application/x-ndjson": {
              itemSchema: { type: "integer", minimum: 0 },
            },
          },
        },
        responses: {
          ...response,
          400: { description: "Controlled rejection" },
        },
      },
    },
  });
  const engine = await StandardEngine.open(source, { allowWrite: true });
  const received = [];
  const fixture = http.createServer(async (request, response) => {
    const parts = [];
    for await (const part of request) parts.push(part);
    received.push(Buffer.concat(parts));
    response.writeHead(400).end();
  });
  await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  try {
    const plan = await engine.plan();
    const invalidItem = plan.cases.find(
      (item) =>
        item.negative &&
        item.reason === "body_schema" &&
        Object.hasOwn(item, "body"),
    );
    assert.ok(
      invalidItem,
      "An invalid item can be encoded as JSONL; omission is not equivalent coverage",
    );
    assert.equal((await engine.validateRequest(invalidItem)).valid, false);
    const result = await engine.execute(
      `http://127.0.0.1:${fixture.address().port}`,
      invalidItem,
    );
    assert.equal(result.record.passed, true, JSON.stringify(result.record));
    assert.equal(received.length, 1);
    assert.ok(
      received[0].length > 0,
      "Negative instances must reach the controlled receiver, not be blocked during serialization",
    );
  } finally {
    await engine.close();
    fixture.closeAllConnections();
    await new Promise((resolve) => fixture.close(resolve));
  }
});

test("inapplicable or absent Encoding mappings never evaluate or generate ignored part headers", async () => {
  const received = [];
  const fixture = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received.push(Buffer.concat(chunks).toString("utf8"));
    response
      .writeHead(200, { "content-type": "application/json" })
      .end('{"ok":true}');
  });
  await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  try {
    for (const media of [
      "application/json",
      "application/x-www-form-urlencoded",
      "multipart/form-data",
    ]) {
      const source = document("3.2.1", {
        "/items": {
          post: {
            operationId: "items",
            requestBody: {
              required: true,
              content: {
                [media]: {
                  schema: {
                    type: "object",
                    required: ["present"],
                    properties: { present: { type: "string" } },
                  },
                  encoding: {
                    // This key is absent from the data. Even a false Header
                    // Schema is not a request requirement for a missing part.
                    unused: { headers: { Hidden: { schema: false } } },
                    ...(media === "application/x-www-form-urlencoded"
                      ? {
                          present: {
                            headers: { FormIgnored: { schema: false } },
                          },
                        }
                      : {}),
                  },
                },
              },
            },
            responses: response,
          },
        },
      });
      const engine = await StandardEngine.open(source, { allowWrite: true });
      try {
        const result = await engine.execute(
          `http://127.0.0.1:${fixture.address().port}`,
          {
            operation_id: "items",
            parameters: [],
            media,
            body: { present: "ok" },
            negative: false,
          },
        );
        assert.equal(
          result.record?.passed,
          true,
          media + ": " + JSON.stringify(result),
        );
      } finally {
        await engine.close();
      }
    }
    const nestedSource = document("3.2.1", {
      "/items": {
        post: {
          operationId: "items",
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  properties: {
                    present: {
                      type: "object",
                      properties: { inner: { type: "string" } },
                    },
                  },
                },
                encoding: {
                  present: {
                    contentType: "application/json",
                    // A multipart outer part does not make its JSON child's
                    // encoding map active. The child media controls that.
                    encoding: {
                      inner: {
                        headers: { IgnoredJSONHeader: { schema: false } },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: response,
        },
      },
    });
    const nestedEngine = await StandardEngine.open(nestedSource, {
      allowWrite: true,
    });
    try {
      const result = await nestedEngine.execute(
        `http://127.0.0.1:${fixture.address().port}`,
        {
          operation_id: "items",
          parameters: [],
          media: "multipart/form-data",
          body: { present: { inner: "ok" } },
          negative: false,
        },
      );
      assert.equal(
        result.record?.passed,
        true,
        "JSON child encoding: " + JSON.stringify(result),
      );
    } finally {
      await nestedEngine.close();
    }
    const styled = JSON.parse(nestedSource);
    const part =
      styled.paths["/items"].post.requestBody.content["multipart/form-data"]
        .encoding.present;
    part.contentType = "multipart/mixed";
    part.style = "form";
    part.explode = false;
    const styledEngine = await StandardEngine.open(JSON.stringify(styled), {
      allowWrite: true,
    });
    try {
      const result = await styledEngine.execute(
        `http://127.0.0.1:${fixture.address().port}`,
        {
          operation_id: "items",
          parameters: [],
          media: "multipart/form-data",
          body: { present: { inner: "ok" } },
          negative: false,
        },
      );
      assert.equal(result.record?.passed, true, JSON.stringify(result));
      assert.match(received.at(-1), /content-type: text\/plain/i);
      assert.doesNotMatch(received.at(-1), /IgnoredJSONHeader/);
    } finally {
      await styledEngine.close();
    }
    const repeated = JSON.parse(nestedSource);
    const repeatedContent =
      repeated.paths["/items"].post.requestBody.content["multipart/form-data"];
    const item = repeatedContent.schema.properties.present;
    repeatedContent.schema.properties.present = { type: "array", items: item };
    repeatedContent.encoding.present.contentType = "multipart/mixed";
    repeatedContent.encoding.present.encoding.inner = {
      contentType: "text/plain",
      headers: {
        RepeatedNested: {
          required: true,
          schema: { type: "integer", const: 7 },
        },
      },
    };
    const repeatedEngine = await StandardEngine.open(JSON.stringify(repeated), {
      allowWrite: true,
    });
    try {
      const result = await repeatedEngine.execute(
        `http://127.0.0.1:${fixture.address().port}`,
        {
          operation_id: "items",
          parameters: [],
          media: "multipart/form-data",
          body: { present: [{ inner: "first" }, { inner: "second" }] },
          negative: false,
        },
      );
      assert.equal(result.record?.passed, true, JSON.stringify(result));
      assert.equal(
        (received.at(-1).match(/repeatednested: 7/gi) ?? []).length,
        2,
      );
    } finally {
      await repeatedEngine.close();
    }
    assert.equal(received.length, 6);
    assert.equal(
      received.some((text) => /Hidden|FormIgnored/.test(text)),
      false,
    );
  } finally {
    fixture.closeAllConnections();
    await new Promise((resolve) => fixture.close(resolve));
  }
});

test("positional nested multipart requests generate required headers for active parts and ignore absent tuple positions", async () => {
  let raw;
  const fixture = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    raw = Buffer.concat(chunks).toString("utf8");
    response
      .writeHead(200, { "content-type": "application/json" })
      .end('{"ok":true}');
  });
  await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  const content = {
    schema: {
      type: "array",
      prefixItems: [
        {
          type: "array",
          prefixItems: [{ type: "string" }, { type: "string" }],
          items: false,
        },
        { type: "string" },
      ],
      items: false,
    },
    prefixEncoding: [
      {
        contentType: "multipart/mixed",
        style: "form", // ignored under multipart/mixed; nested MIME stays active
        headers: {
          OptionalImpossible: { schema: false },
          OptionalUnsafe: {
            schema: { type: "string", const: "synthetic\nline" },
          },
          Outer: {
            required: true,
            schema: { type: "string", pattern: "^[A-Z]{3}$" },
          },
        },
        prefixEncoding: [
          {
            contentType: "text/plain",
            headers: {
              First: {
                required: true,
                schema: { type: "integer", minimum: 7, maximum: 7 },
              },
            },
          },
          {
            contentType: "text/plain",
            headers: {
              Second: { required: true, schema: { type: "boolean" } },
            },
          },
          {
            headers: {
              AbsentNestedPosition: { required: true, schema: false },
            },
          },
        ],
      },
      {
        contentType: "text/plain",
        headers: {
          Tail: {
            required: true,
            schema: { type: "string", pattern: "^tail-[0-9]$" },
          },
        },
      },
      { headers: { AbsentRootPosition: { required: true, schema: false } } },
    ],
    itemEncoding: {
      headers: { AbsentRemainingItems: { required: true, schema: false } },
    },
  };
  const source = document("3.2.1", {
    "/items": {
      post: {
        operationId: "items",
        requestBody: {
          required: true,
          content: { "multipart/mixed": content },
        },
        responses: response,
      },
    },
  });
  let engine;
  try {
    engine = await StandardEngine.open(source, { allowWrite: true });
    const result = await engine.execute(
      `http://127.0.0.1:${fixture.address().port}`,
      {
        operation_id: "items",
        parameters: [],
        media: "multipart/mixed",
        body: [["alpha", "beta"], "tail"],
        negative: false,
      },
    );
    assert.equal(result.record?.passed, true, JSON.stringify(result));
    assert.match(raw, /outer: [A-Z]{3}\r\n/);
    assert.match(raw, /first: 7\r\n/);
    assert.match(raw, /second: (?:true|false)\r\n/);
    assert.match(raw, /tail: tail-[0-9]\r\n/);
    assert.equal(/Absent(?:Nested|Root|Remaining)/.test(raw), false);
    assert.doesNotMatch(raw, /optionalimpossible/i);
    assert.doesNotMatch(raw, /optionalunsafe/i);
  } finally {
    await engine?.close();
    fixture.closeAllConnections();
    await new Promise((resolve) => fixture.close(resolve));
  }
});

test("optional unsatisfiable parameters and bodies keep their valid absence plans; required variants remain blocked", async () => {
  for (const kind of ["parameter", "body"])
    for (const required of [false, true]) {
      const op = { operationId: "optional", responses: response };
      if (kind === "parameter")
        op.parameters = [
          { name: "optional", in: "query", required, schema: false },
        ];
      else
        op.requestBody = {
          required,
          content: { "application/json": { schema: false } },
        };
      const engine = await StandardEngine.open(
        document("3.2.1", { "/optional": { post: op } }),
        { allowWrite: true },
      );
      try {
        const plan = await engine.plan();
        if (required) {
          assert.equal(plan.cases.length, 0);
          assert.ok(plan.blockers.length > 0);
        } else {
          assert.equal(plan.blockers.length, 0);
          assert.ok(plan.cases.length > 0);
          for (const c of plan.cases) {
            assert.equal(c.parameters.length, 0);
            assert.equal(Object.hasOwn(c, "body"), false);
            assert.equal((await engine.validateRequest(c)).valid, true);
          }
        }
      } finally {
        await engine.close();
      }
    }
});

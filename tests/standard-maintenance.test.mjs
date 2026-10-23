import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { stringify } from "yaml";
import { StandardEngine } from "../platform/standard.mjs";
import { encodeRequest } from "../platform/standard-codec.mjs";

const minimal = (schema, media = "application/json") => ({
  openapi: "3.0.3",
  info: { title: "Synthetic maintenance fixture", version: "1" },
  paths: {
    "/test": {
      post: {
        operationId: "test",
        requestBody: { required: true, content: { [media]: { schema } } },
        responses: {
          200: { description: "OK", content: { [media]: { schema } } },
          400: { description: "Invalid" },
        },
      },
    },
  },
});
async function use(doc, fn, options) {
  const engine = await StandardEngine.open(JSON.stringify(doc), options);
  try {
    return await fn(engine);
  } finally {
    await engine.close();
  }
}
test("schema validation combines sibling constraints instead of ignoring them", async () => {
  await use(
    minimal({
      type: "number",
      minimum: 0,
      maximum: 10,
      multipleOf: 0.5,
      not: { enum: [1] },
      allOf: [{ minimum: 0.5 }],
    }),
    async (engine) => {
      for (const [body, expected] of [
        [0.5, true],
        [1, false],
        [0, false],
        [11, false],
        [0.7, false],
        ["1", false],
      ])
        assert.equal(
          (
            await engine.validateRequest({
              operation_id: "test",
              parameters: [],
              media: "application/json",
              body,
            })
          ).valid,
          expected,
        );
    },
  );
});
test("nullable does not bypass enum or composition and no type is legal", async () => {
  for (const [schema, expected] of [
    [{ type: "string", nullable: true, enum: ["yes"] }, false],
    [{ type: "string", nullable: true }, true],
    [{ not: { type: "string" } }, true],
  ]) {
    await use(minimal(schema), async (engine) => {
      assert.equal(
        (
          await engine.validateRequest({
            operation_id: "test",
            parameters: [],
            media: "application/json",
            body: null,
          })
        ).valid,
        expected,
      );
    });
  }
});
test("recursive schemas accept finite data and local escaped pointers", async () => {
  const d = minimal({ $ref: "#/components/schemas/Node~1value" });
  d.components = {
    schemas: {
      "Node/value": {
        type: "object",
        required: ["value"],
        properties: {
          value: { type: "integer" },
          child: { $ref: "#/components/schemas/Node~1value" },
        },
      },
    },
  };
  await use(d, async (engine) => {
    const c = {
      operation_id: "test",
      parameters: [],
      media: "application/json",
      body: { value: 1, child: { value: 2 } },
    };
    assert.equal((await engine.validateRequest(c)).valid, true);
    c.body.child.value = "bad";
    assert.equal((await engine.validateRequest(c)).valid, false);
  });
});
test("generation projects required readOnly fields and retains required writeOnly fields", async () => {
  await use(
    minimal({
      type: "object",
      required: ["id", "secret"],
      properties: {
        id: { type: "integer", readOnly: true },
        secret: { type: "string", enum: ["synthetic-only"], writeOnly: true },
      },
    }),
    async (engine) => {
      const plan = await engine.plan();
      assert.deepEqual(plan.blockers, []);
      const positive = plan.cases.find((c) => !c.negative);
      assert.equal(Object.hasOwn(positive.body, "id"), false);
      assert.equal(positive.body.secret, "synthetic-only");
      assert.equal(
        (
          await engine.validateResponse(
            "test",
            200,
            { id: 1 },
            { "content-type": "application/json" },
          )
        ).valid,
        true,
      );
      assert.equal(
        (
          await engine.validateResponse(
            "test",
            200,
            { id: 1, secret: "synthetic-only" },
            { "content-type": "application/json" },
          )
        ).valid,
        false,
      );
    },
  );
});
test("multiple request media and optional-body branches are generated and revalidated", async () => {
  const d = minimal({ type: "string", minLength: 1 }, "text/plain");
  const body = d.paths["/test"].post.requestBody;
  body.required = false;
  body.content["application/x-www-form-urlencoded"] = {
    schema: {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string", enum: ["a b"] } },
    },
  };
  body.content["multipart/form-data"] = {
    schema: {
      type: "object",
      required: ["file"],
      properties: {
        file: { type: "string", format: "binary", example: "synthetic" },
      },
    },
  };
  await use(d, async (engine) => {
    const plan = await engine.plan();
    assert.deepEqual(plan.blockers, []);
    for (const media of [
      "text/plain",
      "application/x-www-form-urlencoded",
      "multipart/form-data",
    ]) {
      const c = plan.cases.find((c) => c.media === media && !c.negative);
      assert.ok(c, media);
      const wire = encodeRequest(engine.description.operations[0], c);
      if (media === "multipart/form-data") {
        assert.ok(wire.body instanceof FormData);
        assert.ok(wire.body.get("file") instanceof Blob);
        assert.equal(wire.headers["content-type"], undefined);
      } else assert.equal(wire.headers["content-type"], media);
    }
    assert.ok(plan.cases.some((c) => c.reason === "optional_body_omitted"));
  });
});
test("response simple array and object headers preserve schema constraints", async () => {
  const d = minimal({ type: "string" });
  d.paths["/test"].post.responses[200].headers = {
    "x-list": {
      required: true,
      schema: { type: "array", items: { type: "integer", minimum: 1 } },
    },
    "x-map": {
      explode: true,
      schema: {
        type: "object",
        required: ["n"],
        properties: { n: { type: "integer" } },
      },
    },
  };
  await use(d, async (engine) => {
    const headers = {
      "content-type": "application/json",
      "x-list": "1,2",
      "x-map": "n=3",
    };
    assert.equal(
      (await engine.validateResponse("test", 200, "ok", headers)).valid,
      true,
    );
    headers["x-list"] = "1,zero";
    assert.equal(
      (await engine.validateResponse("test", 200, "ok", headers)).valid,
      false,
    );
  });
});
async function server(handler) {
  const instance = http.createServer(handler);
  await new Promise((resolve) => instance.listen(0, "127.0.0.1", resolve));
  return {
    base: `http://127.0.0.1:${instance.address().port}`,
    close: () =>
      new Promise((resolve) => {
        instance.close(resolve);
        instance.closeAllConnections();
      }),
  };
}
test("security AND/OR credentials are explicit, scoped and absent from reports", async () => {
  const secret = "synthetic-credential-never-publish";
  const d = minimal({ type: "string", enum: ["fixture"] });
  d.paths["/test"].post.security = [
    { key: [], oauth: ["read"] },
    { basic: [] },
  ];
  d.components = {
    securitySchemes: {
      key: { type: "apiKey", in: "header", name: "x-api-key" },
      oauth: {
        type: "oauth2",
        flows: {
          clientCredentials: {
            tokenUrl: "https://fixture.invalid/token",
            scopes: { read: "fixture scope" },
          },
        },
      },
      basic: { type: "http", scheme: "basic" },
    },
  };
  let hits = 0;
  const f = await server(async (req, res) => {
    hits++;
    assert.equal(req.headers["x-api-key"], secret);
    assert.equal(req.headers.authorization, "Bearer " + secret);
    let raw = "";
    for await (const c of req) raw += c;
    res.writeHead(raw === '"fixture"' ? 200 : 400, {
      "content-type": "application/json",
    });
    res.end('"fixture"');
  });
  try {
    await use(
      d,
      async (e) => {
        const r = await e.run(f.base);
        assert.equal(r.passed, false);
        assert.equal(hits, 0);
      },
      { allowWrite: true },
    );
    await use(
      d,
      async (e) => {
        const r = await e.run(f.base);
        assert.equal(r.passed, true, JSON.stringify(r));
        assert.ok(hits > 0);
        assert.ok(!JSON.stringify(r).includes(secret));
      },
      {
        allowWrite: true,
        credentials: {
          key: { value: secret },
          oauth: { value: secret, scopes: ["read"] },
        },
      },
    );
  } finally {
    await f.close();
  }
});
test("redirects are not followed and positive 4xx is never a successful test", async () => {
  for (const status of [302, 400, 401, 429, 500]) {
    const d = minimal({ type: "string" });
    d.paths["/test"].post.responses.default = { description: "Declared error" };
    const f = await server((req, res) => {
      res.writeHead(status, { location: "http://127.0.0.1:1/private" });
      res.end();
    });
    try {
      await use(
        d,
        async (e) => {
          const r = await e.run(f.base);
          assert.equal(r.passed, false);
          assert.ok(r.records.some((c) => !c.negative && !c.passed));
        },
        { allowWrite: true },
      );
    } finally {
      await f.close();
    }
  }
});
test("binary payloads are byte preserving and declared 204 forbids bodies", async () => {
  const d = minimal(
    { type: "string", format: "binary", example: "\u0000ÿ" },
    "application/octet-stream",
  );
  const f = await server(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    res.writeHead(body.length ? 200 : 400, {
      "content-type": "application/octet-stream",
    });
    res.end(body);
  });
  try {
    await use(
      d,
      async (e) => {
        const r = await e.run(f.base);
        assert.equal(r.passed, true, JSON.stringify(r));
      },
      { allowWrite: true },
    );
  } finally {
    await f.close();
  }
  d.paths["/test"].post.responses[204] = { description: "Empty" };
  await use(d, async (e) => {
    assert.equal(
      (await e.validateResponse("test", 204, undefined, {}, true)).valid,
      true,
    );
    assert.equal(
      (await e.validateResponse("test", 204, "not-empty", {}, false)).valid,
      false,
    );
  });
});
async function cli(args, env = {}) {
  const child = spawn(process.execPath, ["bin/moonapi-standard.mjs", ...args], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, MOONAPI_STANDARD_CREDENTIALS: "", ...env },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "",
    err = "";
  child.stdout.on("data", (b) => (out += b));
  child.stderr.on("data", (b) => (err += b));
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  return { code, out, err };
}
test("standard CLI validates real files, rejects unknown options and hides source values", async () => {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "moonapi-standard-private-"),
  );
  try {
    const file = path.join(root, "private.json"),
      value = "synthetic-private-proposal-canary";
    fs.writeFileSync(
      file,
      JSON.stringify(minimal({ type: "string", example: value })),
    );
    const check = await cli(["check", file]);
    assert.equal(check.code, 0, check.err);
    const plan = await cli(["plan", file]);
    assert.equal(plan.code, 0, plan.err);
    assert.ok(!(plan.out + plan.err).includes(value));
    for (const args of [
      ["plan", file, "--unknown"],
      ["plan", file, "--limit", "1.5"],
      ["run", file],
      ["plan", file, "--limit", "1", "--limit", "2"],
    ]) {
      const result = await cli(args);
      assert.equal(result.code, 2);
      assert.ok(!result.err.includes(root));
    }
    fs.writeFileSync(file, '{"sensitive":"' + value);
    const invalid = await cli(["check", file]);
    assert.equal(invalid.code, 2);
    assert.ok(!(invalid.out + invalid.err).includes(value));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("resource limits and invalid option types fail closed without enabling requests", async () => {
  await assert.rejects(StandardEngine.open("x".repeat(1048577)), /BUDGET/);
  for (const options of [
    { allowWrite: "yes" },
    { limit: 0 },
    { seed: -1 },
    { compilerTimeout: 0 },
    { unknown: true },
  ])
    await assert.rejects(
      StandardEngine.open(JSON.stringify(minimal({})), options),
      /STANDARD_OPTIONS/,
    );
});

test("generation failures and regex CPU limits are explicit, never empty green plans", async () => {
  await use(
    minimal({ type: "string", minLength: 2, maxLength: 1 }),
    async (engine) => {
      const plan = await engine.plan();
      assert.equal(plan.cases.length, 0);
      assert.ok(
        plan.blockers.some(
          (b) => b.code === "generation_unsatisfied_or_budget",
        ),
      );
    },
  );
  const malicious = minimal({ type: "string", pattern: "^(a+)+$" });
  await use(
    malicious,
    async (engine) => {
      await assert.rejects(
        engine.validateRequest({
          operation_id: "test",
          parameters: [],
          media: "application/json",
          body: "a".repeat(64) + "!",
        }),
        /STANDARD_CPU_BUDGET/,
      );
    },
    { compilerTimeout: 2000 },
  );
});

test("JSON empty-body and unsafe-integer responses cannot pass even an unconstrained schema", async () => {
  for (const raw of ["", "9007199254740993"]) {
    const d = minimal({});
    const f = await server((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(raw);
    });
    try {
      await use(
        d,
        async (engine) => {
          const r = await engine.run(f.base);
          assert.equal(r.passed, false);
          assert.ok(
            r.records.some(
              (r) => r.contract_code === "invalid_json_or_precision",
            ),
          );
        },
        { allowWrite: true },
      );
    } finally {
      await f.close();
    }
  }
});

test("YAML 1.2 and granted YAML references work, duplicate keys and unsafe aliases do not", async () => {
  const d = minimal({ type: "string", enum: ["fixture"] });
  const engine = await StandardEngine.open(stringify(d));
  try {
    assert.deepEqual((await engine.plan()).blockers, []);
  } finally {
    await engine.close();
  }
  await assert.rejects(
    StandardEngine.open('{"openapi":"3.0.3","openapi":"3.0.3"}'),
    /STANDARD_DOCUMENT_ENCODING/,
  );
  await assert.rejects(
    StandardEngine.open(
      "openapi: 3.0.3\nunsafe: !!js/function 'function () {}'",
    ),
    /STANDARD_DOCUMENT_ENCODING/,
  );
  d.paths["/test"].post.requestBody.content["application/json"].schema = {
    $ref: "https://fixture.invalid/defs.yaml#/Value",
  };
  await use(
    d,
    async (engine) => {
      assert.deepEqual((await engine.plan()).blockers, []);
    },
    {
      documents: {
        "https://fixture.invalid/defs.yaml":
          "Value:\n  type: string\n  enum: [fixture]\n",
      },
    },
  );
});

test("AND authentication cannot silently overwrite two different credentials in one destination", async () => {
  const d = minimal({ type: "string" });
  d.paths["/test"].post.security = [{ first: [], second: [] }];
  d.components = {
    securitySchemes: {
      first: { type: "apiKey", in: "header", name: "x-key" },
      second: { type: "apiKey", in: "header", name: "x-key" },
    },
  };
  let hits = 0;
  const f = await server((req, res) => {
    hits++;
    res.end();
  });
  try {
    await use(
      d,
      async (engine) => {
        const result = await engine.run(f.base);
        assert.equal(result.passed, false);
        assert.equal(hits, 0);
        assert.ok(
          result.blockers.some(
            (b) => b.code === "serialization_or_auth_blocked",
          ),
        );
      },
      {
        allowWrite: true,
        credentials: {
          first: { value: "fixture-one" },
          second: { value: "fixture-two" },
        },
      },
    );
  } finally {
    await f.close();
  }
});

test("closed engines cannot reuse a cached plan to send HTTP and metadata cannot mutate the runner", async () => {
  let hits = 0;
  const f = await server((req, res) => {
    hits++;
    res.end();
  });
  const engine = await StandardEngine.open(
    JSON.stringify(minimal({ type: "string" })),
    { allowWrite: true },
  );
  try {
    const info = engine.description;
    info.operations[0].path = "/tampered";
    assert.equal(engine.description.operations[0].path, "/test");
    await engine.plan();
    await engine.close();
    await assert.rejects(engine.run(f.base), /STANDARD_ENGINE_CLOSED/);
    await assert.rejects(engine.plan(), /STANDARD_ENGINE_CLOSED/);
    assert.equal(hits, 0);
  } finally {
    await engine.close();
    await f.close();
  }
});

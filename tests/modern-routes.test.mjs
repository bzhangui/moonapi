import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { StandardEngine } from "../platform/standard.mjs";
import { stringifyExact, parseExact } from "../platform/standard-value.mjs";
const document = (version, paths, extra = {}) =>
  stringifyExact({
    openapi: version,
    info: { title: "synthetic native routes", version: "1" },
    paths,
    ...extra,
  });
async function fixture(handler) {
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

test("native cross-document Link operationRef preserves external Schema and exact runtime values", async () => {
  for (const version of ["3.1.2", "3.2.1"]) {
    const uri = "https://grant.invalid/external.json",
      id = parseExact("9223372036854775807");
    const source = document(version, {
      "/start": {
        get: {
          operationId: "start",
          responses: {
            200: {
              description: "synthetic",
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
                  operationRef: uri + "#/paths/~1next/get",
                  parameters: { "query.id": "$response.body#/id" },
                },
              },
            },
          },
        },
      },
    });
    const external = document(
      version,
      {
        "/next": {
          get: {
            operationId: "next",
            parameters: [
              {
                name: "id",
                in: "query",
                required: true,
                schema: { $ref: "#/components/schemas/ID" },
              },
            ],
            responses: {
              200: {
                description: "synthetic",
                content: { "application/json": { schema: { const: true } } },
              },
            },
          },
        },
      },
      { components: { schemas: { ID: { type: "integer", minimum: id } } } },
    );
    let nextHits = 0;
    const f = await fixture((req, res) => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/start") res.end('{"id":9223372036854775807}');
      else {
        nextHits++;
        assert.equal(req.url, "/next?id=9223372036854775807");
        res.end("true");
      }
    });
    const engine = await StandardEngine.open(source, {
      documents: { [uri]: external },
      followLinks: true,
    });
    try {
      const report = await engine.run(f.base);
      assert.equal(report.passed, true, JSON.stringify(report));
      assert.equal(nextHits, 1);
      assert.equal(report.executed, 2);
    } finally {
      await engine.close();
      await f.close();
    }
  }
});

test("native callback HTTP contracts distinguish healthy and injected invalid bodies in both versions", async () => {
  for (const version of ["3.1.2", "3.2.1"])
    for (const bad of [false, true]) {
      const source = document(version, {
        "/start": {
          post: {
            operationId: "start",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["url"],
                    properties: {
                      url: {
                        type: "string",
                        examples: ["http://127.0.0.1/synthetic-placeholder"],
                      },
                    },
                  },
                },
              },
            },
            callbacks: {
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
                    responses: { 200: { description: "synthetic" } },
                  },
                },
              },
            },
            responses: { 200: { description: "synthetic" } },
          },
        },
      });
      let hits = 0;
      const f = await fixture(async (req, res) => {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks));
        } catch {
          res.writeHead(400).end();
          return;
        }
        if (!body?.url?.includes("127.0.0.1:")) {
          res.writeHead(400).end();
          return;
        }
        hits++;
        await fetch(body.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ok: bad ? "bad" : true }),
        });
        res.end();
      });
      const engine = await StandardEngine.open(source, {
        allowWrite: true,
        allowCallbacks: true,
        callbackTimeout: 250,
      });
      try {
        const result = await engine.execute(f.base, {
          operation_id: "start",
          parameters: [],
          body: { url: "http://127.0.0.1/synthetic-placeholder" },
          media: "application/json",
          negative: false,
        });
        assert.equal(hits, 1);
        assert.equal(result.record.passed, !bad, JSON.stringify(result));
        assert.equal(result.record.callbacks_valid, !bad);
      } finally {
        await engine.close();
        await f.close();
      }
    }
});

test("inherited URI security from the entry document reaches a referenced external PathItem", async () => {
  const key = "./auth.json#/components/securitySchemes/key";
  const source = document(
    "3.2.1",
    {
      "/imported": {
        $ref: "https://external.invalid/parts.json#/components/pathItems/X",
      },
    },
    { security: [{ [key]: [] }] },
  );
  const parts = document(
    "3.2.1",
    {},
    {
      components: {
        pathItems: {
          X: {
            get: {
              operationId: "imported",
              responses: {
                200: {
                  content: { "application/json": { schema: { const: true } } },
                },
              },
            },
          },
        },
      },
    },
  );
  const auth = document(
    "3.2.1",
    {},
    {
      components: {
        securitySchemes: {
          key: { type: "apiKey", in: "header", name: "X-Synthetic-Key" },
        },
      },
    },
  );
  let received;
  const f = await fixture((req, res) => {
    received = req.headers["x-synthetic-key"];
    res.writeHead(200, { "content-type": "application/json" }).end("true");
  });
  const engine = await StandardEngine.open(source, {
    documentURI: "https://entry.invalid/main.json",
    documents: {
      "https://external.invalid/parts.json": parts,
      "https://entry.invalid/auth.json": auth,
    },
    credentials: { [key]: { value: "synthetic-only" } },
  });
  try {
    const r = await engine.execute(f.base, {
      operation_id: "imported",
      parameters: [],
      negative: false,
    });
    assert.equal(r.record?.passed, true, JSON.stringify(r));
    assert.equal(received, "synthetic-only");
  } finally {
    await engine.close();
    await f.close();
  }
});

test("component Link identity selects its actual bound route and does not invent unbound routes", async () => {
  for (const bound of [false, true]) {
    const source = document(
      "3.2.1",
      {
        "/start": {
          get: {
            operationId: "start",
            responses: {
              200: { links: { next: { operationId: "component" } } },
            },
          },
        },
        ...(bound
          ? { "/bound": { $ref: "#/components/pathItems/Reusable" } }
          : {}),
      },
      {
        components: {
          pathItems: {
            Reusable: {
              get: { operationId: "component", responses: { 200: {} } },
            },
          },
        },
      },
    );
    const engine = await StandardEngine.open(source);
    try {
      const [link] = await engine.resolveLinks("start", {
        status: 200,
        response: { body: {} },
      });
      if (bound) {
        assert.equal(link.valid, true, JSON.stringify(link));
        assert.equal(link.operation.path, "/bound");
      } else {
        assert.equal(link.test, undefined);
        assert.equal(link.code, "link_target_not_in_document");
      }
    } finally {
      await engine.close();
    }
  }
});

test("URI-keyed webhook security is enforced by the same native scheme lookup as outbound operations", async () => {
  const key =
    "https://auth.invalid/schemes.json#/components/securitySchemes/key";
  const source = document(
    "3.2.1",
    {},
    {
      webhooks: {
        event: {
          post: { security: [{ [key]: ["receiver"] }], responses: { 204: {} } },
        },
      },
    },
  );
  const grant = document(
    "3.2.1",
    {},
    {
      components: {
        securitySchemes: {
          key: { type: "apiKey", in: "header", name: "X-Synthetic-Key" },
        },
      },
    },
  );
  const engine = await StandardEngine.open(source, {
    allowCallbacks: true,
    callbackTimeout: 30,
    documents: { "https://auth.invalid/schemes.json": grant },
    credentials: { [key]: { value: "synthetic-only", roles: ["receiver"] } },
  });
  let receiver;
  try {
    receiver = await engine.createWebhookReceiver("event");
    let r = await fetch(receiver.url, {
      method: "POST",
      headers: { "x-synthetic-key": "wrong" },
    });
    assert.equal(r.status, 401);
    r = await fetch(receiver.url, {
      method: "POST",
      headers: { "x-synthetic-key": "synthetic-only" },
    });
    assert.equal(r.status, 204);
    assert.equal(receiver.records[0].valid, false);
    assert.equal(receiver.records[1].valid, true);
  } finally {
    await receiver?.close();
    await engine.close();
  }
});

test("webhook coercion resource exhaustion is an explicit inconclusive receiver result", async () => {
  const source = document(
    "3.2.1",
    {},
    {
      webhooks: {
        event: {
          post: {
            parameters: [
              {
                name: "Values",
                in: "header",
                required: true,
                schema: {
                  type: "array",
                  items: { type: ["string", "integer"] },
                  contains: { type: "integer" },
                  minContains: 7,
                },
              },
            ],
            responses: { 204: {} },
          },
        },
      },
    },
  );
  const engine = await StandardEngine.open(source, {
    allowCallbacks: true,
    callbackTimeout: 30,
  });
  let receiver;
  try {
    receiver = await engine.createWebhookReceiver("event");
    const r = await fetch(receiver.url, {
      method: "POST",
      headers: { values: "1,1,1,1,1,1,1" },
    });
    assert.equal(r.status, 503);
    assert.equal(receiver.records[0].inconclusive, true);
    assert.equal(receiver.records[0].code, "callback_budget");
    assert.equal(await receiver.settle(), false);
  } finally {
    await receiver?.close();
    await engine.close();
  }
});

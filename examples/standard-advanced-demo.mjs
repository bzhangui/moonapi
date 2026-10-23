// Independent owned HTTP service: it imports no schema validator or codec.
import http from "node:http";
import assert from "node:assert/strict";
import { StandardEngine } from "../platform/standard.mjs";
import { number, stringifyExact } from "../platform/standard-value.mjs";
const ack = { description: "Synthetic acknowledgement" };
const idRule = {
  type: "integer",
  format: "int64",
  enum: [number("9007199254740993")],
};
const responseSchema = {
  type: "object",
  required: ["id"],
  properties: { id: idRule },
};
const submit = {
  operationId: "submit",
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: {
          type: "object",
          required: ["callback", "quantity"],
          properties: {
            callback: {
              type: "string",
              format: "uri",
              example: "http://127.0.0.1/owned",
            },
            quantity: { type: "integer", enum: [1] },
          },
        },
      },
    },
  },
  callbacks: {
    receipt: {
      "{$request.body#/callback}": {
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
  },
  responses: {
    200: {
      description: "Receipt ID",
      content: { "application/json": { schema: responseSchema } },
      links: {
        read: {
          operationId: "receipt",
          parameters: { "path.id": "$response.body#/id" },
        },
      },
    },
    400: ack,
  },
};
const spec = {
  openapi: "3.0.4",
  info: { title: "Owned callback and link demo", version: "1" },
  paths: {
    "/submit": { post: submit },
    "/receipts/{id}": {
      get: {
        operationId: "receipt",
        parameters: [
          { name: "id", in: "path", required: true, schema: idRule },
        ],
        responses: {
          200: {
            description: "XML receipt",
            content: {
              "application/xml": {
                schema: { ...responseSchema, xml: { name: "receipt" } },
              },
            },
          },
          400: ack,
        },
      },
    },
    "/trace": { trace: { operationId: "trace", responses: { 200: ack } } },
  },
};
const results = [];
for (const defect of [false, true]) {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "TRACE" && req.url === "/trace") {
        res.writeHead(200).end();
        return;
      }
      if (req.method === "GET" && req.url.startsWith("/receipts/")) {
        const id = decodeURIComponent(req.url.slice("/receipts/".length));
        if (id !== "9007199254740993") {
          res.writeHead(400).end();
          return;
        }
        res
          .writeHead(200, { "content-type": "application/xml" })
          .end("<receipt><id>9007199254740993</id></receipt>");
        return;
      }
      if (req.method !== "POST" || req.url !== "/submit") {
        req.resume();
        res.writeHead(404).end();
        return;
      }
      let size = 0;
      const chunks = [];
      for await (const c of req) {
        size += c.length;
        if (size > 262144) throw new Error();
        chunks.push(c);
      }
      let value;
      try {
        value = JSON.parse(Buffer.concat(chunks));
      } catch {}
      if (
        value?.quantity !== 1 ||
        typeof value.callback !== "string" ||
        !/^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]+$/.test(value.callback)
      ) {
        res.writeHead(400).end();
        return;
      }
      await fetch(value.callback, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ok: defect ? "deliberate-schema-defect" : true,
        }),
        signal: AbortSignal.timeout(1000),
      });
      res
        .writeHead(200, { "content-type": "application/json" })
        .end('{"id":9007199254740993}');
    } catch {
      res.writeHead(400).end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  let engine;
  try {
    engine = await StandardEngine.open(stringifyExact(spec), {
      allowWrite: true,
      followLinks: true,
      allowCallbacks: true,
      callbackTimeout: 300,
    });
    const result = await engine.run(
      `http://127.0.0.1:${server.address().port}`,
    );
    assert.equal(result.passed, !defect, JSON.stringify(result));
    assert.deepEqual(result.blockers, []);
    assert.ok(result.records.some((r) => r.case_id.startsWith("link-")));
    assert.ok(result.records.some((r) => r.callback_count > 0));
    results.push({
      defect,
      planned: result.planned,
      executed: result.executed,
      failed: result.failed,
      passed: result.passed,
    });
  } finally {
    await engine?.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
}
console.log(
  JSON.stringify(
    { controlled_advanced_demo: true, results, real_user_pilot: false },
    null,
    2,
  ),
);

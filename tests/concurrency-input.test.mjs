import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { concurrentRegisterProbe } from "../platform/concurrency.mjs";
import { StandardWorkflow } from "../platform/workflow.mjs";
import { resourceWorkflow } from "../platform/workflow-templates.mjs";
import {
  workflowSource,
  workflowFixture,
} from "../examples/workflow-fixture.mjs";
test("simultaneously delivered CAS requests distinguish an atomic backend from a lost-update backend", async () => {
  const response = {
    description: "register",
    content: {
      "application/json": {
        schema: {
          type: "object",
          required: ["value"],
          properties: { value: { type: "integer" } },
        },
      },
    },
  };
  const schema = {
    type: "object",
    required: ["expected", "value"],
    properties: { expected: { type: "integer" }, value: { type: "integer" } },
  };
  const operation = {
    operationId: "cas",
    requestBody: {
      required: true,
      content: { "application/json": { schema } },
    },
    responses: { 200: response, 409: response },
  };
  const doc = JSON.stringify({
    openapi: "3.0.4",
    info: { title: "controlled CAS", version: "1" },
    paths: { "/cas": { post: operation } },
  });
  for (const faulty of [false, true]) {
    let value = 0;
    const pending = [];
    const server = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      pending.push({ res, body: JSON.parse(Buffer.concat(chunks)) });
      if (pending.length === 2)
        for (const x of pending) {
          const accepted = faulty || x.body.expected === value;
          if (accepted) value = x.body.value;
          x.res
            .writeHead(accepted ? 200 : 409, {
              "content-type": "application/json",
            })
            .end(JSON.stringify({ value }));
        }
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    try {
      const r = await concurrentRegisterProbe(
        doc,
        `http://127.0.0.1:${server.address().port}`,
        [1, 2].map(() => ({
          kind: "cas",
          expected: 0,
          value: 1,
          request: {
            operation_id: "cas",
            parameters: [],
            negative: false,
            media: "application/json",
            body: { expected: 0, value: 1 },
          },
        })),
        { engineOptions: { allowWrite: true } },
      );
      assert.equal(r.passed, !faulty);
    } finally {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  }
});
test("explicit irrelevant payload shrink is schema-checked, budgeted and independently confirmed", async () => {
  const f = await workflowFixture({ fault: "persistence" }),
    e = await StandardWorkflow.open(workflowSource(), { allowWrite: true });
  try {
    const model = resourceWorkflow({
      create: "create",
      read: "read",
      update: "update",
      remove: "delete",
    });
    model.steps[0].request.body.payload = "x".repeat(2000);
    model.steps[0].shrink_inputs = ["$request.body#/payload"];
    const r = await e.run(f.base, model, {
      reset: f.reset,
      allowReset: true,
      shrink: true,
    });
    assert.equal(r.shrink_confirmed, true);
    assert.ok(r.input_shrink_attempts > 0);
    assert.equal(r.category, "defect");
  } finally {
    await e.close();
    await f.close();
  }
});

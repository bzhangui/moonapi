import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { StandardEngine } from "../platform/standard.mjs";
import { StandardWorkflow } from "../platform/workflow.mjs";
import { ownedResourceWorkflow } from "../platform/workflow-templates.mjs";
import { concurrentRegisterProbe } from "../platform/concurrency.mjs";
import { planResourceGraph } from "../platform/graph.mjs";
import {
  workflowFixture,
  workflowSource,
} from "../examples/workflow-fixture.mjs";
const model = () =>
  ownedResourceWorkflow({
    create: "create",
    read: "read",
    update: "update",
    remove: "delete",
  });
test("a hanging trusted decoder is budgeted and never reports a successful response", async () => {
  const source = JSON.stringify({
    openapi: "3.0.4",
    info: { title: "codec budget", version: "1" },
    paths: {
      "/ok": {
        get: {
          operationId: "ok",
          responses: {
            200: {
              description: "body",
              content: {
                "application/x-controlled": { schema: { type: "string" } },
              },
            },
          },
        },
      },
    },
  });
  const server = http.createServer((req, res) =>
    res.writeHead(200, { "content-type": "application/x-controlled" }).end("x"),
  );
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const e = await StandardEngine.open(source, {
    totalTimeout: 100,
    codecs: {
      "application/x-controlled": {
        encode: () => Buffer.from("x"),
        decode: () => new Promise(() => {}),
      },
    },
  });
  try {
    const r = await e.run(`http://127.0.0.1:${server.address().port}`);
    assert.equal(r.passed, false);
    assert.equal(r.records[0].category, "budget");
    assert.equal(r.execution.responses, 1);
  } finally {
    await e.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
test("malformed cleanup and ownership bindings are rejected before any reset or HTTP side effect", async () => {
  const f = await workflowFixture(),
    e = await StandardWorkflow.open(workflowSource(), { allowWrite: true });
  let resets = 0;
  try {
    for (const mutation of [
      (m) => {
        m.cleanup[0].request.parameters = "bad";
      },
      (m) => {
        m.cleanup[0].ownership.pointer = "/bad~2pointer";
      },
      (m) => {
        m.cleanup[0].bindings[0].target = "$response.body#/id";
      },
      (m) => {
        m.steps[2].ownership.bindings[0].target = "$response.body#/id";
      },
      (m) => {
        m.steps[2].bindings.push({
          from: "create",
          expression: "$response.body#/id",
          target: "$request.body#/server_id",
        });
        m.steps[2].shrink_inputs = ["$request.body#/server_id"];
      },
      (m) => {
        m.initial_state = { x: "missing" };
      },
      (m) => {
        m.steps[0].role = "x".repeat(70);
      },
      (m) => {
        m.cleanup[0].request.parameters = [{ in: "path", name: "id" }];
      },
    ]) {
      const m = model();
      mutation(m);
      await assert.rejects(
        e.run(f.base, m, {
          allowCleanup: true,
          allowReset: true,
          reset: async () => {
            resets++;
            return true;
          },
        }),
        /WORKFLOW/,
      );
    }
    assert.equal(resets, 0);
    assert.equal(f.requests, 0);
  } finally {
    await e.close();
    await f.close();
  }
});
test("unconfirmed lease release cannot produce a green report even after a healthy run", async () => {
  const f = await workflowFixture(),
    e = await StandardWorkflow.open(workflowSource());
  let releases = 0;
  try {
    const r = await e.run(
      f.base,
      {
        version: 1,
        steps: [
          {
            id: "health",
            request: {
              operation_id: "health",
              parameters: [],
              negative: false,
            },
          },
        ],
      },
      {
        isolation: {
          version: 1,
          acquire: async () => ({ ttlMs: 10000 }),
          verify: async () => true,
          release: async () => {
            releases++;
            return false;
          },
        },
      },
    );
    assert.equal(r.passed, false);
    assert.equal(r.code, "isolation_release_failed");
    assert.equal(releases, 1);
  } finally {
    await e.close();
    await f.close();
  }
});
test("contract campaigns stop after an unknown write rather than executing more generated mutations", async () => {
  const f = await workflowFixture({ fault: "committed_response_lost" }),
    e = await StandardEngine.open(workflowSource(), { allowWrite: true });
  try {
    const r = await e.runSelected(f.base, { operationIds: ["create"] });
    assert.equal(r.passed, false);
    assert.equal(r.execution.unknown_writes, 1);
    assert.equal(f.requests, 1);
    assert.equal(f.creates, 1);
    assert.ok(
      r.blockers.some((b) => b.code === "unknown_write_requires_inspection"),
    );
  } finally {
    await e.close();
    await f.close();
  }
});
test("concurrent preflight checks all actors before sending the first mutation", async () => {
  const f = await workflowFixture();
  try {
    await assert.rejects(
      concurrentRegisterProbe(
        workflowSource(),
        f.base,
        [
          {
            kind: "write",
            value: 1,
            request: {
              operation_id: "create",
              parameters: [],
              negative: false,
              media: "application/json",
              body: { name: "owned" },
            },
          },
          {
            kind: "read",
            request: {
              operation_id: "unknown",
              parameters: [],
              negative: false,
            },
          },
        ],
        { engineOptions: { allowWrite: true } },
      ),
      /CONCURRENCY/,
    );
    assert.equal(f.requests, 0);
  } finally {
    await f.close();
  }
});
test("graph rejects zero visits, hidden cleanup and invalid unreachable transition state", async () => {
  const graph = {
    version: 2,
    initial_state: { x: "new" },
    transitions: [
      {
        id: "read",
        max_visits: 0,
        request: { operation_id: "health", parameters: [], negative: false },
      },
    ],
  };
  await assert.rejects(planResourceGraph(graph));
  graph.transitions[0].max_visits = 1;
  graph.cleanup = [];
  await assert.rejects(planResourceGraph(graph), /CLEANUP/);
  delete graph.cleanup;
  graph.transitions[0].requires_state = { x: 42 };
  await assert.rejects(planResourceGraph(graph), /STATE/);
});
test("repeated owned runs leave no fixture resources and do not accumulate stale IDs", async () => {
  const f = await workflowFixture(),
    e = await StandardWorkflow.open(workflowSource(), { allowWrite: true });
  try {
    for (let i = 0; i < 25; i++) {
      const r = await e.run(f.base, model(), { allowCleanup: true });
      assert.equal(r.passed, true);
      assert.equal(r.cleanup_verified, true);
      assert.equal(r.execution.unknown_writes, 0);
      assert.equal(f.remaining, 0);
    }
    assert.equal(f.creates, 25);
  } finally {
    await e.close();
    await f.close();
  }
});

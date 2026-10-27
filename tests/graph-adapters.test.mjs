import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { StandardEngine } from "../platform/standard.mjs";
import { StandardWorkflow } from "../platform/workflow.mjs";
import { planResourceGraph, runGraphCampaign } from "../platform/graph.mjs";
import { environmentCredentials } from "../platform/adapters.mjs";
import {
  workflowSource,
  workflowFixture,
} from "../examples/workflow-fixture.mjs";
test("resource graph plans reproducible legal transitions and binds freshly returned exact IDs", async () => {
  const req = (operation_id, body) => ({
    operation_id,
    parameters: [],
    negative: false,
    ...(body ? { media: "application/json", body } : {}),
  });
  const graph = {
    version: 2,
    initial_state: { item: "absent" },
    transitions: [
      {
        id: "create",
        requires_state: { item: "absent" },
        set_state: { item: "present" },
        request: req("create", { name: "owned" }),
      },
      {
        id: "read",
        requires_state: { item: "present" },
        set_state: { item: "verified" },
        request: req("read"),
        bindings: [
          {
            from: "create",
            expression: "$response.body#/id",
            target: "$request.path.id",
          },
        ],
        assertions: [
          {
            id: "stored",
            kind: "equal",
            left: { from: "read", expression: "$response.body#/name" },
            right: { value: "owned" },
          },
        ],
      },
      {
        id: "delete",
        requires_state: { item: "verified" },
        set_state: { item: "deleted" },
        request: req("delete"),
        bindings: [
          {
            from: "create",
            expression: "$response.body#/id",
            target: "$request.path.id",
          },
        ],
      },
    ],
  };
  const a = await planResourceGraph(graph, { seed: 73 });
  assert.deepEqual(a, await planResourceGraph(graph, { seed: 73 }));
  assert.equal(a.coverage.all_transitions_covered, true);
  const f = await workflowFixture();
  try {
    const r = await runGraphCampaign(workflowSource(), f.base, graph, {
      seeds: [7, 73],
      engineOptions: { allowWrite: true },
      runOptions: { reset: f.reset, allowReset: true },
    });
    assert.equal(r.passed, true);
    assert.equal(f.remaining, 0);
  } finally {
    await f.close();
  }
});
test("v2 resource states reject stale state assumptions before any request", async () => {
  const e = await StandardWorkflow.open(workflowSource());
  try {
    await assert.rejects(
      e.run("http://127.0.0.1:1", {
        version: 2,
        initial_state: { resource: "deleted" },
        steps: [
          {
            id: "read",
            requires_state: { resource: "present" },
            request: {
              operation_id: "health",
              parameters: [],
              negative: false,
            },
          },
        ],
      }),
      /POLICY/,
    );
  } finally {
    await e.close();
  }
});
test("credential provider resolves each role afresh, with explicit auth denial tests and no automatic write retry", async () => {
  const doc = {
    openapi: "3.0.4",
    info: { title: "roles", version: "1" },
    components: {
      securitySchemes: { token: { type: "http", scheme: "bearer" } },
    },
    security: [{ token: [] }],
    paths: {
      "/role": {
        get: {
          operationId: "role",
          responses: {
            200: { description: "allowed" },
            403: { description: "denied" },
          },
        },
      },
    },
  };
  const server = http.createServer((req, res) =>
    res
      .writeHead(req.headers.authorization === "Bearer owner" ? 200 : 403)
      .end(),
  );
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const env = {
      OWNER: JSON.stringify({ token: { value: "owner" } }),
      VIEWER: JSON.stringify({ token: { value: "viewer" } }),
    },
    provider = environmentCredentials(
      { owner: "OWNER", viewer: "VIEWER" },
      env,
    );
  const e = await StandardWorkflow.open(JSON.stringify(doc), {
    credentialProvider: provider,
  });
  try {
    const r = await e.run(`http://127.0.0.1:${server.address().port}`, {
      version: 1,
      steps: [
        {
          id: "allowed",
          role: "owner",
          request: { operation_id: "role", parameters: [], negative: false },
          expect: [200],
        },
        {
          id: "denied",
          role: "viewer",
          authorizationProbe: true,
          request: { operation_id: "role", parameters: [], negative: false },
          expect: [403],
        },
      ],
    });
    assert.equal(r.passed, true);
    env.OWNER = JSON.stringify({ token: { value: "expired" } });
    const expired = await e.run(`http://127.0.0.1:${server.address().port}`, {
      version: 1,
      steps: [
        {
          id: "expired",
          role: "owner",
          request: { operation_id: "role", parameters: [], negative: false },
        },
      ],
    });
    assert.equal(expired.category, "inconclusive");
  } finally {
    await e.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
test("transport adapters use a versioned bounded contract and never bypass base permissions", async () => {
  let calls = 0;
  const transport = {
    version: 1,
    id: "controlled-v1",
    async send() {
      calls++;
      return { status: 200, headers: {}, raw: Buffer.alloc(0) };
    },
  };
  const e = await StandardEngine.open(workflowSource(), { transport });
  try {
    await assert.rejects(
      e.execute("https://example.invalid", {
        operation_id: "health",
        parameters: [],
        negative: false,
      }),
    );
    assert.equal(calls, 0);
    const r = await e.execute("http://127.0.0.1:1", {
      operation_id: "health",
      parameters: [],
      negative: false,
    });
    assert.equal(r.record.passed, true);
  } finally {
    await e.close();
  }
});

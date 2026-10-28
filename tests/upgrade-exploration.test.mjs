import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";
import {
  ownedResourceWorkflow,
  resourceWorkflow,
} from "../platform/workflow-templates.mjs";
import { runGraphCampaign, planResourceGraph } from "../platform/graph.mjs";
import { shrinkValues } from "../platform/input-shrink.mjs";
import { number, stringifyExact, equal } from "../platform/standard-value.mjs";
import { StandardWorkflow } from "../platform/workflow.mjs";
import {
  workflowSource,
  workflowFixture,
} from "../examples/workflow-fixture.mjs";
import { concurrentResourceProbe } from "../platform/concurrency.mjs";
import { diagnoseReport } from "../platform/diagnostics.mjs";
import { recoverSegmentedLedger } from "../platform/execution-ledger.mjs";
test("graph owned cleanup composes without a database-wide reset and requires explicit permission", async () => {
  const owned = ownedResourceWorkflow({
    create: "create",
    read: "read",
    update: "update",
    remove: "delete",
  });
  const graph = {
      version: 2,
      transitions: owned.steps.map((s, i) => ({
        ...s,
        requires_state: { phase: String(i) },
        set_state: { phase: String(i + 1) },
      })),
      cleanup: owned.cleanup,
      initial_state: { phase: "0" },
    },
    f = await workflowFixture();
  try {
    const r = await runGraphCampaign(workflowSource(), f.base, graph, {
      seeds: [7, 42],
      feedback: true,
      engineOptions: { allowWrite: true },
      runOptions: { allowCleanup: true },
    });
    assert.equal(r.passed, true);
    assert.equal(f.remaining, 0);
    assert.ok(r.reports.every((x) => x.cleanup_verified));
    await assert.rejects(
      runGraphCampaign(workflowSource(), f.base, graph, {
        engineOptions: { allowWrite: true },
      }),
      /RESET_REQUIRED/,
    );
    graph.transitions[0].max_visits = 2;
    await assert.rejects(planResourceGraph(graph), /CLEANUP_AMBIGUOUS/);
  } finally {
    await f.close();
  }
});
test("coverage feedback prefers unvisited legal transitions without inventing state or repeating writes", async () => {
  const graph = {
    version: 2,
    initial_state: {},
    transitions: ["first", "second"].map((id) => ({
      id,
      request: { operation_id: "health", negative: false, parameters: [] },
    })),
  };
  const first = await planResourceGraph(graph, { seed: 42, limit: 1 });
  const next = await planResourceGraph(graph, {
    seed: 42,
    limit: 1,
    covered: first.coverage.covered,
  });
  assert.notDeepEqual(first.coverage.selected, next.coverage.selected);
  assert.equal(next.exhaustive_state_space, false);
});
test("nested input shrinking is byte-decreasing, Unicode-aware and preserves exact integer candidates", () => {
  const original = {
    labels: ["😀中文", "long text"],
    payload: { count: number("9223372036854775807") },
  };
  const all = shrinkValues(original);
  assert.ok(all.length > 3);
  for (const x of all)
    assert.ok(
      Buffer.byteLength(stringifyExact(x)) <
        Buffer.byteLength(stringifyExact(original)),
    );
  assert.ok(
    shrinkValues(number("9223372036854775807")).some((x) =>
      equal(x, number("922337203685477580")),
    ),
  );
  assert.ok(shrinkValues("😀中文").includes("😀"));
  assert.ok(!stringifyExact(all).includes('\\ud83d"'));
});
test("workflow writes authenticated segments and recursive input reduction retains independently confirmed fingerprint", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "moonapi-exploration-")),
    f = await workflowFixture({ fault: "persistence" }),
    e = await StandardWorkflow.open(workflowSource(), { allowWrite: true }),
    key = randomBytes(32);
  try {
    const model = resourceWorkflow({
      create: "create",
      read: "read",
      update: "update",
      remove: "delete",
    });
    model.steps[0].request.body.payload = {
      nested: ["irrelevant long text", "keep shrinking"],
    };
    model.steps[0].shrink_inputs = ["$request.body#/payload"];
    const report = await e.run(f.base, model, {
      reset: f.reset,
      allowReset: true,
      shrink: true,
      journalDirectory: dir,
      journalOptions: { authKey: key, segmentBytes: 2048 },
    });
    assert.equal(report.shrink_confirmed, true);
    assert.ok(report.input_shrink_attempts > 0);
    const first = fs
      .readdirSync(dir)
      .find((x) => !/\.\d{4}\.jsonl$/.test(x))
      .slice(0, -6);
    const recovery = await recoverSegmentedLedger(dir, first, { authKey: key });
    assert.equal(recovery.unknown_writes, 0);
    assert.ok(recovery.segments > 1);
  } finally {
    await e.close();
    await f.close();
    fs.rmSync(dir, { recursive: true });
  }
});
test("concurrent stock reservation catches overselling while an atomic control passes", async () => {
  const response = {
    description: "stock",
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
  const source = JSON.stringify({
    openapi: "3.0.4",
    info: { title: "stock", version: "1" },
    paths: {
      "/reserve": {
        post: {
          operationId: "reserve",
          responses: { 200: response, 409: response },
        },
      },
    },
  });
  for (const faulty of [false, true]) {
    let stock = 1;
    const pending = [];
    const server = http.createServer((req, res) => {
      req.resume();
      pending.push(res);
      if (pending.length === 2)
        for (const response of pending) {
          const success = faulty || stock > 0;
          if (success) stock = Math.max(0, stock - 1);
          response
            .writeHead(success ? 200 : 409, {
              "content-type": "application/json",
            })
            .end(JSON.stringify({ value: stock }));
        }
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    try {
      const report = await concurrentResourceProbe(
        source,
        `http://127.0.0.1:${server.address().port}`,
        [1, 2].map(() => ({
          kind: "reserve",
          amount: 1,
          request: { operation_id: "reserve", parameters: [], negative: false },
        })),
        { initial: 1, capacity: 1, engineOptions: { allowWrite: true } },
      );
      assert.equal(report.passed, !faulty);
    } finally {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  }
});
test("actionable diagnostics hide arbitrary content and never grant automatic retry", () => {
  const output = diagnoseReport({
    category: "transport",
    execution: { unknown_writes: 1 },
    cleanup_verified: false,
    private: "PRIVATE_SENTINEL",
  });
  assert.deepEqual(
    output.actions.map((a) => a.code),
    ["unknown_write", "cleanup_unconfirmed", "transport"],
  );
  assert.equal(output.automatic_replay_permitted, false);
  assert.ok(!JSON.stringify(output).includes("PRIVATE_SENTINEL"));
});
test("uncertain concurrent writes retain their receipt ledger and return inconclusive without replay", async () => {
  const f = await workflowFixture({ fault: "committed_response_lost" });
  try {
    const report = await concurrentResourceProbe(
      workflowSource(),
      f.base,
      [
        {
          kind: "reserve",
          amount: 1,
          request: {
            operation_id: "create",
            negative: false,
            parameters: [],
            media: "application/json",
            body: { name: "synthetic" },
          },
        },
      ],
      { engineOptions: { allowWrite: true } },
    );
    assert.equal(report.passed, false);
    assert.equal(report.inconclusive, true);
    assert.equal(report.execution.unknown_writes, 1);
    assert.equal(f.creates, 1);
    assert.equal(report.automatic_replay_permitted, false);
  } finally {
    await f.close();
  }
});

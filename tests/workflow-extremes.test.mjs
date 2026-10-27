import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { StandardEngine } from "../platform/standard.mjs";
import { StandardWorkflow } from "../platform/workflow.mjs";
import {
  inventoryWorkflow,
  resourceWorkflow,
} from "../platform/workflow-templates.mjs";
import {
  workflowFixture,
  workflowSource,
} from "../examples/workflow-fixture.mjs";
import { orderFixture, orderSource } from "../examples/order-fixture.mjs";
import { callbackReceiver } from "../platform/standard-callback.mjs";
test("closing a workflow prevents reset side effects and cancels an in-flight reset wait", async () => {
  const e = await StandardWorkflow.open(workflowSource(), { allowWrite: true });
  let resets = 0;
  await e.close();
  await assert.rejects(
    e.run("http://127.0.0.1:1", resource(), {
      allowReset: true,
      reset: () => {
        resets++;
        return true;
      },
    }),
    /CLOSED/,
  );
  assert.equal(resets, 0);
  const active = await StandardWorkflow.open(workflowSource(), {
    allowWrite: true,
  });
  let started;
  const ready = new Promise((r) => (started = r));
  const run = active.run("http://127.0.0.1:1", resource(), {
    allowReset: true,
    reset: () => {
      started();
      return new Promise(() => {});
    },
  });
  await ready;
  await active.close();
  const report = await run;
  assert.equal(report.passed, false);
  assert.equal(report.category, "blocked");
});
const resource = () =>
  resourceWorkflow({
    create: "create",
    read: "read",
    update: "update",
    remove: "delete",
  });
test("standard inventory template detects double cancellation credits with healthy control", async () => {
  // Add required response descriptions to the older independently implemented fixture contract.
  const doc = JSON.parse(orderSource());
  for (const item of Object.values(doc.paths))
    for (const op of Object.values(item))
      if (op.responses)
        for (const r of Object.values(op.responses)) r.description = "fixture";
  for (const doubleCredit of [false, true]) {
    const f = await orderFixture({ doubleCredit }),
      e = await StandardWorkflow.open(JSON.stringify(doc), {
        allowWrite: true,
      });
    try {
      const reset = async (signal) =>
        (await fetch(f.base + "/__test/reset", { method: "POST", signal }))
          .status === 204;
      const report = await e.run(
        f.base,
        inventoryWorkflow({
          inventory: "inventory",
          reserve: "reserve",
          cancel: "cancel",
          quantity: 2,
        }),
        { allowReset: true, reset, shrink: doubleCredit },
      );
      assert.equal(report.passed, !doubleCredit);
      if (doubleCredit) {
        assert.equal(report.shrink_confirmed, true);
        assert.equal(report.retained_step_ids.length, 5);
      }
    } finally {
      await e.close();
      await f.close();
    }
  }
});
test("delete-without-effect is detected, expected missing status cannot mask contract failures", async () => {
  const f = await workflowFixture({ fault: "delete" }),
    e = await StandardWorkflow.open(workflowSource(), { allowWrite: true });
  try {
    const r = await e.run(f.base, resource(), {
      reset: f.reset,
      allowReset: true,
      shrink: true,
    });
    assert.equal(r.code, "business_status");
    assert.equal(r.shrink_confirmed, true);
  } finally {
    await e.close();
    await f.close();
  }
});
test("four concurrent callers keep observations and exact IDs isolated on the same owned backend", async () => {
  const f = await workflowFixture(),
    engines = await Promise.all(
      Array.from({ length: 4 }, () =>
        StandardWorkflow.open(workflowSource(), { allowWrite: true }),
      ),
    );
  try {
    const reports = await Promise.all(
      engines.map((e, i) =>
        e.run(
          f.base,
          resourceWorkflow({
            create: "create",
            read: "read",
            update: "update",
            remove: "delete",
            initial: "owned-" + i,
            changed: "changed-" + i,
          }),
        ),
      ),
    );
    assert.ok(reports.every((r) => r.passed));
    assert.equal(f.creates, 4);
    assert.equal(f.remaining, 0);
  } finally {
    await Promise.all(engines.map((e) => e.close()));
    await f.close();
  }
});
test("total time budget includes HTTP and a hanging reset; no budget is a confirmed defect", async () => {
  const f = await workflowFixture({ delay: 250 }),
    e = await StandardWorkflow.open(workflowSource(), {
      allowWrite: true,
      timeout: 1000,
    });
  try {
    const r = await e.run(f.base, resource(), { totalTimeout: 100 });
    assert.equal(r.category, "budget");
    assert.equal(r.shrink_confirmed, false);
    const hanging = await e.run(f.base, resource(), {
      totalTimeout: 100,
      allowReset: true,
      reset: () => new Promise(() => {}),
    });
    assert.equal(hanging.category, "budget");
  } finally {
    await e.close();
    await f.close();
  }
});
test("late invalid duplicate callbacks are detected throughout the bounded window; order is retained", async () => {
  const order = [],
    receiver = await callbackReceiver(async (incoming) => {
      const body = JSON.parse(Buffer.from(incoming.raw, "base64"));
      order.push(body.version);
      return { valid: typeof body.version === "number", status: 200 };
    }, 150);
  try {
    const send = (version) =>
      fetch(receiver.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version }),
      });
    await send(2);
    await send(1);
    await send(2);
    const late = new Promise((resolve, reject) =>
      setTimeout(() => send("invalid").then(resolve, reject), 50),
    );
    assert.equal(await receiver.settle(), false);
    await late;
    assert.deepEqual(order, [2, 1, 2, "invalid"]);
  } finally {
    await receiver.close();
  }
});
test("public standard summaries classify transport, access, budget and defect separately", async () => {
  const doc = {
    openapi: "3.0.4",
    info: { title: "classifications", version: "1" },
    paths: {
      "/x": {
        get: {
          operationId: "x",
          responses: {
            200: { description: "ok" },
            401: { description: "auth" },
            500: { description: "bad" },
          },
        },
      },
    },
  };
  for (const status of [200, 401, 500]) {
    const s = http.createServer((req, res) => res.writeHead(status).end());
    await new Promise((r) => s.listen(0, "127.0.0.1", r));
    const e = await StandardEngine.open(JSON.stringify(doc));
    try {
      const r = await e.execute(`http://127.0.0.1:${s.address().port}`, {
        operation_id: "x",
        parameters: [],
        negative: false,
      });
      assert.equal(
        r.record.category,
        { 200: "passed", 401: "inconclusive", 500: "defect" }[status],
      );
    } finally {
      await e.close();
      s.closeAllConnections();
      await new Promise((r) => s.close(r));
    }
  }
});

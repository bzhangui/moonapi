import test from "node:test";
import assert from "node:assert/strict";
import { StandardEngine } from "../platform/standard.mjs";
import { StandardWorkflow, workflowModel } from "../platform/workflow.mjs";
import {
  resourceWorkflow,
  idempotencyWorkflow,
  asyncWorkflow,
  discoverDependencies,
} from "../platform/workflow-templates.mjs";
import {
  workflowSource,
  workflowFixture,
} from "../examples/workflow-fixture.mjs";
const resource = () =>
  resourceWorkflow({
    create: "create",
    read: "read",
    update: "update",
    remove: "delete",
  });
async function use(fault, fn, options = { allowWrite: true }) {
  const fixture = await workflowFixture({ fault }),
    engine = await StandardWorkflow.open(workflowSource(), options);
  try {
    return await fn(engine, fixture);
  } finally {
    await engine.close();
    await fixture.close();
  }
}
test("standard workflow captures exact int64 IDs, fresh reset IDs, and reduces persistence failure with state preconditions", async () => {
  await use("", async (e, f) => {
    const r = await e.run(f.base, resource(), {
      reset: f.reset,
      allowReset: true,
    });
    assert.equal(r.passed, true);
    assert.equal(r.records.length, 6);
    assert.equal(f.remaining, 0);
  });
  await use("persistence", async (e, f) => {
    const r = await e.run(f.base, resource(), {
      reset: f.reset,
      allowReset: true,
      shrink: true,
    });
    assert.equal(r.category, "defect");
    assert.equal(r.shrink_confirmed, true);
    assert.deepEqual(r.retained_step_ids, ["create", "update", "verify"]);
    assert.ok(!JSON.stringify(r).includes("owned"));
  });
});
test("template duplicate idempotency is a business regression, not just a schema check", async () => {
  for (const fault of ["", "idempotency"])
    await use(fault, async (e, f) => {
      const model = idempotencyWorkflow({
        operation: "create",
        key: "fixture-key",
        body: { name: "owned" },
      });
      const r = await e.run(f.base, model, {
        reset: f.reset,
        allowReset: true,
        shrink: !!fault,
      });
      assert.equal(r.passed, !fault);
      if (fault) assert.equal(r.shrink_confirmed, true);
    });
});
test("bounded eventual consistency polls safe reads; never retries an uncertain committed write", async () => {
  for (const fault of ["", "never_done"])
    await use(fault, async (e, f) => {
      const r = await e.run(
        f.base,
        asyncWorkflow({
          submit: "submit",
          poll: "poll",
          attempts: 4,
          interval: 1,
        }),
      );
      assert.equal(r.passed, !fault);
      assert.equal(f.requests, 1 + (fault ? 4 : 3));
    });
  await use("committed_response_lost", async (e, f) => {
    const r = await e.run(f.base, resource());
    assert.equal(r.category, "transport");
    assert.equal(f.creates, 1);
    assert.equal(f.requests, 1);
    assert.equal(r.shrink_attempts, 0);
  });
});
test("all permissions and model checks run before reset and HTTP", async () => {
  await use(
    "",
    async (e, f) => {
      let resets = 0;
      const reset = () => {
        resets++;
        return true;
      };
      await assert.rejects(
        e.run(f.base, resource(), { reset, allowReset: true }),
        /WRITE_NOT_AUTHORIZED/,
      );
      assert.equal(resets, 0);
      assert.equal(f.requests, 0);
    },
    {},
  );
  await use("", async (e, f) => {
    let resets = 0;
    const reset = () => {
      resets++;
      return true;
    };
    await assert.rejects(
      e.run("https://example.invalid/", resource(), {
        reset,
        allowReset: true,
      }),
    );
    const model = resource();
    model.steps[0].bindings = [
      {
        from: "verify",
        expression: "$response.body#/id",
        target: "$request.path.id",
      },
    ];
    await assert.rejects(
      e.run(f.base, model, { reset, allowReset: true }),
      /REFERENCE/,
    );
    const bad = resource();
    bad.steps[0].poll = { attempts: 2, interval: 1 };
    await assert.rejects(e.run(f.base, bad), /POLL_POLICY/);
    await assert.rejects(
      e.run(f.base, resource(), { shrink: true }),
      /RESET_NOT_AUTHORIZED/,
    );
    assert.equal(resets, 0);
    assert.equal(f.requests, 0);
    const r = await e.run(f.base, resource(), {
      reset: () => false,
      allowReset: true,
    });
    assert.equal(r.code, "reset_unconfirmed");
    assert.equal(f.requests, 0);
  });
});
test("unstable resets cannot confirm shrinking and missing bindings cannot execute guessed IDs", async () => {
  await use("persistence", async (e, f) => {
    let count = 0;
    const r = await e.run(f.base, resource(), {
      allowReset: true,
      reset: () => (++count === 1 ? f.reset() : false),
      shrink: true,
    });
    assert.equal(r.unstable, true);
    assert.equal(r.shrink_confirmed, false);
    const m = resource();
    m.steps[1].bindings[0].expression = "$response.body#/missing";
    const missing = await e.run(f.base, m, {
      reset: f.reset,
      allowReset: true,
    });
    assert.equal(missing.code, "binding_missing");
  });
});
test("unified state assertions and dependency metadata reject invalid states and unknown operations", async () => {
  const e = await StandardWorkflow.open(workflowSource());
  try {
    const model = resource();
    model.steps[0].requires = ["missing"];
    assert.throws(() => workflowModel(model, e.description), /POLICY/);
    model.steps[0].request.operation_id = "unknown";
    assert.throws(() => workflowModel(model, e.description), /REQUEST/);
  } finally {
    await e.close();
  }
});
test("discovery produces explicit Links and schema/Location candidates without executing writes", async () => {
  const e = await StandardEngine.open(workflowSource());
  try {
    const d = await discoverDependencies(e);
    assert.ok(d.suggestions.some((x) => x.kind === "explicit-link"));
    assert.ok(d.suggestions.some((x) => x.kind === "location"));
    assert.ok(d.suggestions.some((x) => x.kind === "schema-field"));
    assert.ok(d.suggestions.every((x) => x.automatic_write === false));
  } finally {
    await e.close();
  }
});
test("closed engines, expired deadline, and concurrent workflow invocation do not silently pass", async () => {
  await use("", async (e, f) => {
    let release;
    const ready = new Promise((r) => (release = r));
    const first = e.run(f.base, resource(), {
      allowReset: true,
      reset: async () => {
        await ready;
        return true;
      },
    });
    await assert.rejects(e.run(f.base, resource()), /BUSY/);
    release();
    await first;
  });
  const fixture = await workflowFixture(),
    e = await StandardEngine.open(workflowSource());
  try {
    const result = await e.execute(
      fixture.base,
      { operation_id: "health", negative: false, parameters: [] },
      { deadline: Date.now() - 1 },
    );
    assert.equal(result.record, undefined);
    assert.equal(result.blockers[0].code, "total_deadline");
    assert.equal(fixture.requests, 0);
  } finally {
    await e.close();
    await fixture.close();
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { BehaviorEngine } from "../platform/behavior.mjs";
import { loadCore, Engine } from "../platform/runner.mjs";
import { fixture } from "../examples/fixture.mjs";
import { behaviorSource, resetHook } from "../examples/behavior-demo.mjs";
import {
  orderSource,
  orderModel,
  orderFixture,
} from "../examples/order-fixture.mjs";
await loadCore();
test("scenario generation honors the configured seed and legacy chains do not shrink polluted state", async () => {
  assert.equal(
    new Engine(source, { seed: 7 }).command("scenario", {
      step: { operationId: "health" },
      bindings: {},
    }).case.id,
    "health-7",
  );
  const server = await fixture({ bug: true });
  try {
    const report = await new Engine(source, {
      allowWrite: true,
      shrinkWrite: true,
    }).run(server.base, {
      scenario: {
        steps: [
          {
            operationId: "echo",
            body: { name: "a long enough controlled input" },
          },
        ],
      },
    });
    assert.equal(report.failed, 1);
    assert.equal(report.results[0].shrink_attempts, 0);
    assert.equal(
      report.results[0].shrink_reason,
      "stateful_sequence_requires_reset_mode",
    );
    assert.equal(server.requests, 1);
  } finally {
    await server.close();
  }
});
const source = behaviorSource();
const model = () =>
  JSON.parse(
    fs.readFileSync(
      new URL("../examples/behavior.json", import.meta.url),
      "utf8",
    ),
  );
const options = { allowWrite: true, shrinkWrite: true, shrinkBudget: 32 };
async function runFixture(settings, work) {
  const server = await fixture({ enableReset: true, ...settings });
  try {
    return await work(server, await resetHook(source, server.base));
  } finally {
    await server.close();
  }
}

test("healthy state model passes actual create update read delete lifecycle", () =>
  runFixture({}, async (s, reset) => {
    const report = await new BehaviorEngine(source, options).run(
      s.base,
      model(),
      { reset, allowReset: true },
    );
    assert.equal(report.complete, true);
    assert.equal(report.executed, 8);
    assert.equal(s.resets, 1);
  }));
test("contract-valid lost update produces verified three-step dependency-preserving witness", () =>
  runFixture({ staleUpdate: true }, async (s, reset) => {
    const runner = new BehaviorEngine(source, options);
    const report = await runner.run(s.base, model(), {
      reset,
      allowReset: true,
      saveRepro: true,
    });
    assert.equal(report.property_failure_confirmed, true);
    assert.equal(
      report.fingerprint,
      "readback:behavior_assertion:persisted_name",
    );
    assert.equal(report.minimized_steps, 3);
    assert.deepEqual(
      report.reproduction.model.steps.map((x) => x.id),
      ["create", "update", "readback"],
    );
    assert.ok(s.resets >= 3);
    assert.equal(report.reset_count, s.resets);
    assert.ok(
      !JSON.stringify({ ...report, reproduction: undefined }).includes(
        "second",
      ),
    );
    const replay = await runner.run(s.base, report.reproduction.model, {
      reset,
      allowReset: true,
    });
    assert.equal(replay.fingerprint, report.fingerprint);
    assert.equal(replay.property_failure_confirmed, true);
  }));
test("ignored delete is discovered despite valid response schema and removed noise", () =>
  runFixture({ ignoreDelete: true }, async (s, reset) => {
    const report = await new BehaviorEngine(source, options).run(
      s.base,
      model(),
      { reset, allowReset: true },
    );
    assert.ok(
      report.fingerprint.startsWith(
        "read_deleted:contract:200:scenario_status",
      ),
    );
    assert.equal(report.property_failure_confirmed, true);
    assert.ok(report.minimized_steps < 8);
  }));
test("whole-plan write and reset permission gates run before any HTTP mutation", () =>
  runFixture({}, async (s, reset) => {
    await assert.rejects(() =>
      new BehaviorEngine(source).run(s.base, model(), {
        reset,
        allowReset: true,
      }),
    );
    await assert.rejects(() =>
      new BehaviorEngine(source, options).run(s.base, model(), { reset }),
    );
    assert.equal(s.requests, 0);
  }));
test("missing data dependency and unknown later operation fail before reset", () =>
  runFixture({}, async (s, reset) => {
    const bad = model();
    bad.steps[2].parameters.id.$from = "unknown";
    await assert.rejects(() =>
      new BehaviorEngine(source, options).run(s.base, bad, {
        reset,
        allowReset: true,
      }),
    );
    const unknown = model();
    unknown.steps.at(-1).operationId = "not_registered";
    await assert.rejects(() =>
      new BehaviorEngine(source, options).run(s.base, unknown, {
        reset,
        allowReset: true,
      }),
    );
    assert.equal(s.requests, 0);
  }));
test("write replay is never implied by initial write authorization", () =>
  runFixture({ staleUpdate: true }, async (s, reset) => {
    const report = await new BehaviorEngine(source, { allowWrite: true }).run(
      s.base,
      model(),
      { reset, allowReset: true },
    );
    assert.equal(report.property_failure_confirmed, false);
    assert.equal(report.shrink_attempts, 0);
    assert.equal(report.shrink_reason, "write_sequence_replay_not_authorized");
    assert.equal(s.resets, 1);
  }));
test("inconsistent property failures are not promoted to reproducible witnesses", () =>
  runFixture({ unstableRead: true }, async (s, reset) => {
    const report = await new BehaviorEngine(source, options).run(
      s.base,
      model(),
      { reset, allowReset: true, saveRepro: true },
    );
    assert.equal(report.property_failure_confirmed, false);
    assert.equal(report.shrink_reason, "unstable_failure");
    assert.equal(report.reproduction, undefined);
  }));
test("reset failure cannot be mistaken for a property failure or success", () =>
  runFixture({}, async (s) => {
    const report = await new BehaviorEngine(source, options).run(
      s.base,
      model(),
      { reset: async () => false, allowReset: true },
    );
    assert.equal(report.complete, false);
    assert.equal(report.executed, 0);
    assert.equal(report.stop_reason, "reset_or_execution_error");
    assert.equal(s.requests, 0);
  }));
test("reset deadlines are bounded and abort the hook without continuing requests", () =>
  runFixture({}, async (s) => {
    let aborted = false;
    const reset = ({ signal }) =>
      new Promise((resolve) =>
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            resolve(false);
          },
          { once: true },
        ),
      );
    const report = await new BehaviorEngine(source, {
      ...options,
      timeout: 20,
    }).run(s.base, model(), { reset, allowReset: true });
    assert.equal(report.complete, false);
    assert.equal(aborted, true);
    assert.equal(s.requests, 0);
    const slow = await fixture({ slow: true });
    try {
      const engine = new Engine(source, { timeout: 1000 });
      const current = engine.command("scenario", {
        step: { operationId: "health" },
        bindings: {},
      }).case;
      const controller = new AbortController();
      controller.abort();
      const observed = await engine.observe(
        slow.base,
        current,
        Date.now() + 1000,
        controller.signal,
      );
      assert.equal(observed.status, 0);
      assert.equal(slow.requests, 0);
    } finally {
      await slow.close();
    }
  }));
test("generated state-driven traces are deterministic and validate before I/O", () =>
  runFixture({}, async (s, reset) => {
    const explicit = model();
    const generated = {
      format: 1,
      name: "generated",
      initial: explicit.initial,
      transitions: explicit.steps.filter((x) => !x.id.startsWith("noise")),
    };
    const runner = new BehaviorEngine(source, options),
      plan = runner.plan(generated, { steps: 20 });
    assert.deepEqual(plan, runner.plan(generated, { steps: 20 }));
    const report = await runner.run(s.base, generated, {
      reset,
      allowReset: true,
      steps: 20,
    });
    assert.equal(report.complete, true);
    assert.equal(report.total_transitions, 6);
    assert.ok(report.covered_transitions.length >= 4);
    assert.equal(
      report.model_coverage_complete,
      report.covered_transitions.length === report.total_transitions,
    );
    for (const seed of [0, 1, 7, 99, 1000000]) {
      const next = await new BehaviorEngine(source, { ...options, seed }).run(
        s.base,
        generated,
        { reset, allowReset: true, steps: 16 },
      );
      assert.equal(next.complete, true);
    }
  }));

test("inventory conservation catches double cancellation with entirely valid contracts", async () => {
  for (const bug of [false, true]) {
    const s = await orderFixture({ doubleCredit: bug }),
      source = orderSource();
    try {
      const report = await new BehaviorEngine(source, options).run(
        s.base,
        orderModel(),
        {
          reset: await resetHook(source, s.base),
          allowReset: true,
          saveRepro: true,
        },
      );
      assert.equal(report.complete, !bug);
      if (bug) {
        assert.equal(
          report.fingerprint,
          "inventory_after:behavior_assertion:inventory_conserved",
        );
        assert.equal(report.property_failure_confirmed, true);
        assert.equal(report.minimized_steps, 5);
      }
    } finally {
      await s.close();
    }
  }
});

test("planning needs no write consent and rejects malformed dormant transitions", () => {
  const runner = new BehaviorEngine(source);
  assert.equal(runner.plan(model()).trace.steps.length, 8);
  const m = model();
  m.steps[0].status = "200";
  assert.throws(() => runner.plan(m));
  const m2 = model();
  m2.steps[0].body = { unused: true };
  assert.throws(() => runner.plan(m2));
  const m3 = model();
  m3.steps[0].parameters = { unexpected: 1 };
  assert.throws(() => runner.plan(m3));
  for (const [op, expected] of [
    ["gte", "not numeric"],
    ["length", -1],
  ]) {
    const m = model();
    m.steps[0].assert = [{ id: "bad_operand", pointer: "/ok", op, expected }];
    assert.throws(() => runner.plan(m));
  }
  for (const bad of [
    Infinity,
    NaN,
    9007199254740992,
    undefined,
    1n,
    new Date(),
  ]) {
    const m = model();
    m.initial.bad = bad;
    assert.throws(() => runner.plan(m));
  }
  const sparse = model();
  sparse.steps[1].body = { name: new Array(2) };
  assert.throws(() => runner.plan(sparse));
});

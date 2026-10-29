import test from "node:test";
import assert from "node:assert/strict";
import { StandardWorkflow } from "../platform/workflow.mjs";
import {
  protectedOwnedWorkflow,
  ownedResourceWorkflow,
} from "../platform/workflow-templates.mjs";
import {
  workflowSource,
  workflowFixture,
} from "../examples/workflow-fixture.mjs";
import { standardHTTP } from "../platform/standard-http.mjs";
import { inputProtection } from "../platform/input-protection.mjs";
import { inputCandidates } from "../platform/input-shrink.mjs";
import { planResourceGraph, runGraphCampaign } from "../platform/graph.mjs";
const options = {
  create: "create",
  read: "read",
  update: "update",
  remove: "delete",
};
test("protected owned reduction shrinks exogenous data without a global reset or changing markers", async () => {
  const f = await workflowFixture({ fault: "persistence" }),
    names = [],
    model = protectedOwnedWorkflow(options);
  model.steps[0].request.body.payload = {
    nested: ["😀中文 extra payload", "long noise"],
  };
  model.steps[0].shrink_inputs = ["$request.body"];
  const e = await StandardWorkflow.open(workflowSource(), {
    allowWrite: true,
    transport: {
      version: 1,
      id: "controlled-owned-capture",
      send: async (url, request) => {
        if (["POST", "PATCH"].includes(request.method))
          names.push(JSON.parse(request.body).name);
        return standardHTTP(url, request);
      },
    },
  });
  try {
    const r = await e.run(f.base, model, { allowCleanup: true, shrink: true });
    assert.equal(r.category, "defect");
    assert.equal(r.shrink_confirmed, true);
    assert.ok(r.input_shrink_attempts > 0);
    assert.equal(r.cleanup_verified, true);
    assert.equal(f.remaining, 0);
    const allowed = model.cleanup[0].ownership.allowed;
    assert.ok(names.length > 3 && names.every((n) => allowed.includes(n)));
    assert.equal(
      r.input_shrink_policy,
      "explicit_exogenous_targets_with_owned_source_locks",
    );
  } finally {
    await e.close();
    await f.close();
  }
});
test("source locks filter destructive ancestors and protect nested Unicode markers", () => {
  const model = protectedOwnedWorkflow(options);
  model.steps[0].request.body.payload = "irrelevant";
  model.steps[0].shrink_inputs = ["$request.body"];
  const protection = inputProtection(model),
    candidates = inputCandidates(model.steps, { protection });
  assert.equal(protection.complete, true);
  assert.ok(candidates.length > 0);
  assert.ok(
    candidates.every(
      (s) => s[0].request.body.name === model.steps[0].request.body.name,
    ),
  );
  assert.ok(
    candidates.some((s) => !Object.hasOwn(s[0].request.body, "payload")),
  );
});
test("legacy owned models retain the old disabled-input policy; incomplete locks cannot grant replay", async () => {
  assert.equal(ownedResourceWorkflow(options).version, 1);
  const f = await workflowFixture(),
    e = await StandardWorkflow.open(workflowSource(), { allowWrite: true });
  try {
    const m = protectedOwnedWorkflow(options);
    m.input_protection.pop();
    await assert.rejects(
      e.run(f.base, m, { allowCleanup: true, shrink: true }),
      /RESET_NOT_AUTHORIZED/,
    );
    assert.equal(f.requests, 0);
    for (const bad of [
      null,
      [{ step: "missing", target: "$request.body#/name" }],
      [{ step: "create", target: "$request.header.Authorization" }],
      [m.input_protection[0], m.input_protection[0]],
    ])
      await assert.rejects(
        e.run(f.base, { ...m, input_protection: bad }, { allowCleanup: true }),
        /INPUT/,
      );
    assert.equal(f.requests, 0);
  } finally {
    await e.close();
    await f.close();
  }
});
test("unconfirmed cleanup during confirmation halts all later candidates and never creates a witness", async () => {
  const f = await workflowFixture({ fault: "persistence" });
  let deletes = 0;
  const e = await StandardWorkflow.open(workflowSource(), {
    allowWrite: true,
    transport: {
      version: 1,
      id: "controlled-second-cleanup-loss",
      send: async (url, request) => {
        if (request.method === "DELETE" && ++deletes >= 2) {
          request.onSent?.();
          return { status: 204, headers: {}, raw: Buffer.alloc(0) };
        }
        return standardHTTP(url, request);
      },
    },
  });
  try {
    const model = protectedOwnedWorkflow(options);
    model.steps[0].request.body.payload = "noise";
    model.steps[0].shrink_inputs = ["$request.body#/payload"];
    const r = await e.run(f.base, model, { allowCleanup: true, shrink: true });
    assert.equal(r.category, "blocked");
    assert.equal(r.original_category, "defect");
    assert.equal(r.code, "cleanup_unconfirmed");
    assert.equal(r.shrinking_stopped_cleanup_unconfirmed, true);
    assert.equal(r.shrink_confirmed, false);
    assert.equal(r.witness_saved, false);
    assert.equal(f.creates, 2);
    assert.equal(deletes, 2);
  } finally {
    await e.close();
    await f.close();
  }
});
test("resource graphs project complete source locks onto unique selected instances", async () => {
  const m = protectedOwnedWorkflow(options),
    graph = {
      version: 2,
      initial_state: { phase: "0" },
      transitions: m.steps.map((s, i) => ({
        ...s,
        requires_state: { phase: String(i) },
        set_state: { phase: String(i + 1) },
      })),
      cleanup: m.cleanup,
      input_protection: m.input_protection,
    };
  const plan = await planResourceGraph(graph);
  assert.ok(
    plan.model.input_protection.every((l) =>
      plan.model.steps.some((s) => s.id === l.step),
    ),
  );
  assert.equal(inputProtection(plan.model).complete, true);
  const f = await workflowFixture();
  try {
    const r = await runGraphCampaign(workflowSource(), f.base, graph, {
      seeds: [42, 7],
      engineOptions: { allowWrite: true },
      runOptions: { allowCleanup: true, shrink: true },
    });
    assert.equal(r.passed, true);
    assert.equal(f.remaining, 0);
    graph.transitions[0].max_visits = 2;
    await assert.rejects(planResourceGraph(graph), /INPUT_PROTECTION/);
  } finally {
    await f.close();
  }
});

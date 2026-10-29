import test from "node:test";
import assert from "node:assert/strict";
import { ResponseCorpus } from "../platform/response-corpus.mjs";
import { documentDigest, publicReport } from "../platform/ci-tools.mjs";
import { intentEnvironmentBinding } from "../platform/execution-intent.mjs";
import { StandardWorkflow } from "../platform/workflow.mjs";
import {
  feedbackSource,
  feedbackFixture,
  feedbackModel,
} from "../examples/feedback-fixture.mjs";
import { protectedOwnedWorkflow } from "../platform/workflow-templates.mjs";
import {
  bindExpression,
  expression,
  requestContext,
} from "../platform/standard-expression.mjs";
import {
  workflowSource,
  workflowFixture,
} from "../examples/workflow-fixture.mjs";
const corpus = (base, extra = {}) =>
  new ResponseCorpus({
    documentBinding: documentDigest(feedbackSource()),
    environmentBinding: intentEnvironmentBinding(base),
    sources: [
      {
        id: "codes",
        operation: "hints",
        pointer: "/values",
        explode: true,
        consumers: ["quote"],
      },
    ],
    ...extra,
  });
test("response values are schema-checked before use and feedback freezes for confirmation and shrinking", async () => {
  const f = await feedbackFixture({ fault: "unicode" }),
    c = corpus(f.base),
    e = await StandardWorkflow.open(feedbackSource(), { allowWrite: true });
  try {
    const r = await e.run(f.base, feedbackModel(), {
      feedbackCorpus: c,
      allowReset: true,
      reset: f.reset,
      shrink: true,
    });
    assert.equal(r.category, "defect");
    assert.equal(r.shrink_confirmed, true);
    assert.ok(r.input_shrink_attempts > 0);
    assert.equal(r.feedback.selections, 1);
    assert.equal(r.feedback.observations, 3);
    assert.equal(r.feedback.frozen_for_replay, true);
    assert.equal(r.feedback.persisted, false);
    assert.ok(!JSON.stringify(publicReport(r)).includes("中文&ß"));
    assert.ok(!JSON.stringify(c.summary()).includes("alpha"));
  } finally {
    await e.close();
    await f.close();
  }
});
test("a healthy feedback-driven control passes across multiple values without a fixed manual payload", async () => {
  const f = await feedbackFixture(),
    c = corpus(f.base),
    e = await StandardWorkflow.open(feedbackSource(), { allowWrite: true });
  try {
    for (let i = 0; i < 3; i++)
      assert.equal(
        (await e.run(f.base, feedbackModel(), { feedbackCorpus: c })).passed,
        true,
      );
    assert.equal(c.summary().selections, 3);
    assert.equal(c.summary().values, 3);
  } finally {
    await e.close();
    await f.close();
  }
});
test("document, environment, role and operation grants are checked before reset or HTTP", async () => {
  const f = await feedbackFixture(),
    e = await StandardWorkflow.open(feedbackSource(), { allowWrite: true });
  try {
    const c = corpus(f.base),
      m = feedbackModel();
    m.steps[1].role = "viewer";
    await assert.rejects(
      e.run(f.base, m, { feedbackCorpus: c, allowReset: true, reset: f.reset }),
      /SOURCE_NOT_GRANTED/,
    );
    await assert.rejects(
      e.run(f.base, feedbackModel(), {
        feedbackCorpus: corpus("http://127.0.0.1:1"),
      }),
      /SCOPE/,
    );
    await assert.rejects(
      e.run(f.base, feedbackModel(), {
        feedbackCorpus: corpus(f.base, { documentBinding: "0".repeat(64) }),
      }),
      /SCOPE/,
    );
    await assert.rejects(e.run(f.base, feedbackModel()), /CORPUS_REQUIRED/);
    assert.equal(f.requests, 0);
    const overlapping = feedbackModel();
    overlapping.steps[1].feedback_inputs.push({
      source: "codes",
      target: "$request.body",
    });
    await assert.rejects(
      e.run(f.base, overlapping, { feedbackCorpus: corpus(f.base) }),
      /PROTECTED_TARGET/,
    );
    assert.equal(f.requests, 0);
    assert.equal(f.resets, 0);
  } finally {
    await e.close();
    await f.close();
  }
});
test("feedback cannot overwrite a returned ID binding or an ownership marker", async () => {
  const f = await feedbackFixture(),
    e = await StandardWorkflow.open(feedbackSource(), { allowWrite: true });
  try {
    const m = feedbackModel();
    m.steps[1].bindings = [
      {
        from: "catalog",
        expression: "$response.body#/values/0",
        target: "$request.body#/code",
      },
    ];
    await assert.rejects(
      e.run(f.base, m, { feedbackCorpus: corpus(f.base) }),
      /BOUND_TARGET/,
    );
    assert.equal(f.requests, 0);
  } finally {
    await e.close();
    await f.close();
  }
  const owned = await workflowFixture(),
    o = await StandardWorkflow.open(workflowSource(), { allowWrite: true });
  try {
    const m = protectedOwnedWorkflow({
      create: "create",
      read: "read",
      update: "update",
      remove: "delete",
    });
    m.steps[0].feedback_inputs = [
      { source: "codes", target: "$request.body#/name" },
    ];
    await assert.rejects(
      o.run(owned.base, m, { allowCleanup: true }),
      /PROTECTED_TARGET/,
    );
    m.steps[0].feedback_inputs[0].target = "$request.body#/payload";
    delete m.input_protection;
    await assert.rejects(
      o.run(owned.base, m, { allowCleanup: true }),
      /OWNERSHIP_UNPROVEN/,
    );
    assert.equal(owned.requests, 0);
  } finally {
    await o.close();
    await owned.close();
  }
});
test("bounded private corpus evicts or drops samples without persisting raw response data", async () => {
  const c = corpus("http://127.0.0.1:1", { maxValues: 2, maxBytes: 1024 });
  c.observe("hints", undefined, {
    values: ["first", "second", "third", "x".repeat(9000)],
  });
  assert.equal(c.summary().values, 2);
  assert.equal(c.summary().dropped, 2);
  assert.ok(c.summary().bytes <= 1024);
  const values = c.candidates("codes", "quote", "default");
  assert.ok(!values.some((v) => v.value === "first"));
  assert.ok(["second", "third"].includes(await c.choose(values, 42)));
});
test("input target parsing and binding preserve literal braces instead of retargeting a protected sibling", () => {
  const request = {
    body: { id: "protected", "id}": "initial", nested: { "a/b~}": "initial" } },
    parameters: [
      { in: "query", name: "code", value: "protected" },
      { in: "query", name: "code}", value: "initial" },
    ],
  };
  for (const target of [
    "$request.body#/id}",
    "$request.body#/nested/a~1b~0}",
    "$request.query.code}",
  ]) {
    assert.equal(bindExpression(request, target, "selected"), true);
    assert.equal(
      expression(target, { request: requestContext(request) }),
      "selected",
    );
  }
  assert.equal(request.body.id, "protected");
  assert.equal(request.parameters[0].value, "protected");
  assert.equal(
    bindExpression(request, "{$request.body#/id}}", "wrapped"),
    true,
  );
  assert.equal(request.body["id}"], "wrapped");
  assert.equal(bindExpression(request, "{$request.body#/id", "bad"), false);
});
test("feedback rejects declared query API-key destinations before reset or network", async () => {
  const f = await feedbackFixture(),
    definition = JSON.parse(feedbackSource());
  definition.components = {
    securitySchemes: { key: { type: "apiKey", in: "query", name: "api_key" } },
  };
  definition.security = [{ key: [] }];
  const engine = await StandardWorkflow.open(JSON.stringify(definition), {
    allowWrite: true,
  });
  try {
    const m = feedbackModel();
    m.steps[1].feedback_inputs[0].target = "$request.query.api_key";
    await assert.rejects(
      engine.run(f.base, m, { allowReset: true, reset: f.reset }),
      /AUTH_TARGET/,
    );
    assert.equal(f.requests, 0);
    assert.equal(f.resets, 0);
  } finally {
    await engine.close();
    await f.close();
  }
});
test("unknown writes block both further shrinking and reuse of the same learning corpus", async () => {
  const f = await feedbackFixture({ fault: "lost" }),
    c = corpus(f.base),
    e = await StandardWorkflow.open(feedbackSource(), { allowWrite: true });
  try {
    const r = await e.run(f.base, feedbackModel(), {
      feedbackCorpus: c,
      allowReset: true,
      reset: f.reset,
      shrink: true,
    });
    assert.equal(r.execution.unknown_writes, 1);
    assert.equal(f.writes, 1);
    assert.equal(c.summary().blocked_after_unresolved_side_effect, true);
    const requests = f.requests,
      resets = f.resets;
    await assert.rejects(
      e.run(f.base, feedbackModel(), {
        feedbackCorpus: c,
        allowReset: true,
        reset: f.reset,
      }),
      /UNRESOLVED_SIDE_EFFECT/,
    );
    assert.equal(f.requests, requests);
    assert.equal(f.resets, resets);
  } finally {
    await e.close();
    await f.close();
  }
});
test("feedback composes with protected owned cleanup without modifying marker sources", async () => {
  const f = await workflowFixture(),
    source = workflowSource(),
    e = await StandardWorkflow.open(source, { allowWrite: true });
  const c = new ResponseCorpus({
    documentBinding: documentDigest(source),
    environmentBinding: intentEnvironmentBinding(f.base),
    sources: [
      {
        id: "names",
        operation: "create",
        pointer: "/name",
        consumers: ["update"],
      },
    ],
  });
  try {
    const m = protectedOwnedWorkflow({
      create: "create",
      read: "read",
      update: "update",
      remove: "delete",
    });
    const update = m.steps.find((s) => s.id === "update");
    update.request.body.payload = "initial";
    update.feedback_inputs = [
      { source: "names", target: "$request.body#/payload", required: true },
    ];
    const r = await e.run(f.base, m, {
      allowCleanup: true,
      feedbackCorpus: c,
      shrink: true,
    });
    assert.equal(r.passed, true);
    assert.equal(r.cleanup_verified, true);
    assert.equal(f.remaining, 0);
    assert.equal(c.summary().selections, 1);
  } finally {
    await e.close();
    await f.close();
  }
});
test("isolation release failure blocks reuse of learned values before any further reset or HTTP", async () => {
  const f = await feedbackFixture(),
    c = corpus(f.base),
    e = await StandardWorkflow.open(feedbackSource(), { allowWrite: true });
  try {
    const r = await e.run(f.base, feedbackModel(), {
      feedbackCorpus: c,
      isolation: {
        version: 1,
        acquire: async () => ({ ttlMs: 30000 }),
        verify: async () => true,
        release: async () => false,
      },
    });
    assert.equal(r.code, "isolation_release_failed");
    assert.equal(r.feedback.blocked_after_unresolved_side_effect, true);
    assert.equal(c.summary().blocked_after_unresolved_side_effect, true);
    const before = f.requests;
    await assert.rejects(
      e.run(f.base, feedbackModel(), {
        feedbackCorpus: c,
        allowReset: true,
        reset: f.reset,
      }),
      /UNRESOLVED_SIDE_EFFECT/,
    );
    assert.equal(f.requests, before);
    assert.equal(f.resets, 0);
  } finally {
    await e.close();
    await f.close();
  }
});

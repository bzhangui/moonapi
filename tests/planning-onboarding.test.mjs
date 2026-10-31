import test from "node:test";
import assert from "node:assert/strict";
import { inspectProject } from "../platform/project-config.mjs";
import { StandardEngine } from "../platform/standard.mjs";
import { planningPolicy } from "../platform/planning.mjs";
import {
  failureCategory,
  explainBlockers,
} from "../platform/failure-category.mjs";
import {
  workflowSource,
  workflowFixture,
} from "../examples/workflow-fixture.mjs";
test("onboarding proposes declared dependencies without sending HTTP or granting writes", async () => {
  const f = await workflowFixture();
  try {
    const r = await inspectProject(workflowSource());
    assert.ok(
      r.onboarding.proposals.some(
        (p) =>
          p.from === "create" && p.to === "read" && p.confidence === "declared",
      ),
    );
    assert.equal(r.onboarding.dependency_ir.execution_authorized, false);
    assert.equal(
      r.onboarding.coverage.every((c) => !c.execution_observed),
      true,
    );
    assert.deepEqual(r.readonly_default, ["health"]);
    assert.equal(f.requests, 0);
  } finally {
    await f.close();
  }
});
test("authenticated read and required-body QUERY never become safe onboarding defaults", async () => {
  const d = JSON.parse(workflowSource());
  d.components.securitySchemes = { secret: { type: "http", scheme: "bearer" } };
  d.paths["/health"].get.security = [{ secret: [] }];
  const r = await inspectProject(JSON.stringify(d));
  assert.deepEqual(r.readonly_default, []);
  assert.ok(r.onboarding.gates.authentication.includes("health"));
});
test("operationRef declarations become reviewed IR edges without executing links", async () => {
  const d = JSON.parse(workflowSource());
  d.paths["/items"].post.responses["201"].links.read = {
    operationRef: "#/paths/~1items~1{id}/get",
    parameters: { id: "$response.body#/id" },
  };
  const r = await inspectProject(JSON.stringify(d));
  assert.ok(
    r.onboarding.proposals.some(
      (p) =>
        p.from === "create" && p.to === "read" && p.confidence === "declared",
    ),
  );
});
test("granting a linked document does not automatically expand default execution scope", async () => {
  const response = { description: "ok" },
    externalURI = "https://granted.invalid/external.json";
  const source = JSON.stringify({
    openapi: "3.2.1",
    info: { title: "root", version: "1" },
    paths: {
      "/start": {
        get: {
          operationId: "start",
          responses: {
            200: {
              ...response,
              links: {
                next: { operationRef: externalURI + "#/paths/~1external/get" },
              },
            },
          },
        },
      },
    },
  });
  const external = JSON.stringify({
    openapi: "3.2.1",
    info: { title: "granted", version: "1" },
    paths: {
      "/external": {
        get: { operationId: "external", responses: { 200: response } },
      },
    },
  });
  const r = await inspectProject(source, {
    documents: { [externalURI]: external },
  });
  assert.ok(r.onboarding.proposals.length > 0);
  assert.deepEqual(r.readonly_default, ["start"]);
  assert.deepEqual(r.onboarding.presets.readonly.operationIds, ["start"]);
  assert.ok(r.onboarding.coverage.some((o) => o.outside_selected_document));
});
test("dependency IR exposes cycles, rejects dangling/duplicate IDs and unsafe versions are not silently migrated", () => {
  const catalog = [{ id: "a" }, { id: "b" }];
  const r = planningPolicy("dependency-ir", {
    catalog,
    edges: [
      { from: "a", to: "b", kind: "link" },
      { from: "b", to: "a", kind: "link" },
    ],
  });
  assert.equal(r.acyclic, false);
  assert.deepEqual(r.unresolved, ["a", "b"]);
  for (const args of [
    { catalog: [{ id: "a" }, { id: "a" }], edges: [] },
    { catalog, edges: [{ from: "a", to: "missing", kind: "link" }] },
    { catalog, edges: [{ from: "a", to: "b", kind: "execute" }] },
    {
      catalog: Array.from({ length: 257 }, (_, i) => ({ id: String(i) })),
      edges: [],
    },
  ])
    assert.throws(() => planningPolicy("dependency-ir", args));
});
test("MoonBit coverage scheduling prioritizes unseen operations without starving the first round", async () => {
  const args = {
    catalog: [
      { id: "a", count: 3, visits: 100 },
      { id: "b", count: 3, visits: 0 },
    ],
    seed: 0,
    limit: 3,
  };
  const r = planningPolicy("coverage-schedule", args);
  assert.deepEqual(
    r.selected.map((x) => x.operation_id),
    ["b", "a", "b"],
  );
  assert.equal(r.truncated, true);
  const e = await StandardEngine.open(workflowSource(), {
    limit: 2,
    priorCoverage: { health: 100 },
  });
  try {
    const p = await e.plan();
    assert.equal(p.cases[0].operation_id, "create");
    assert.equal(
      p.operation_coverage.find((x) => x.operation_id === "health").observed,
      100,
    );
  } finally {
    await e.close();
  }
  for (const v of [null, [], { a: -1 }, { a: 0.5 }, { a: Infinity }])
    await assert.rejects(
      StandardEngine.open(workflowSource(), { priorCoverage: v }),
    );
  await assert.rejects(
    StandardEngine.open(workflowSource(), { priorCoverage: { missing: 1 } }),
    /COVERAGE_OPERATION/,
  );
});
test("prototype-named operation IDs cannot inherit coverage visits from object prototypes", async () => {
  const d = JSON.parse(workflowSource());
  d.paths["/health"].get.operationId = "constructor";
  const e = await StandardEngine.open(JSON.stringify(d), { priorCoverage: {} });
  try {
    assert.equal(
      (await e.plan()).operation_coverage.find(
        (x) => x.operation_id === "constructor",
      ).observed,
      0,
    );
  } finally {
    await e.close();
  }
});
test("fixed diagnostic taxonomy distinguishes generation, resource budgets and confirmed defects without leaking input", () => {
  assert.equal(
    failureCategory("STANDARD_GENERATION_UNSAT_OR_BUDGET"),
    "generation",
  );
  assert.equal(failureCategory("STANDARD_CPU_BUDGET"), "budget");
  assert.equal(failureCategory("response_schema"), "contract");
  assert.equal(
    failureCategory("response_schema", { unknownWrite: true }),
    "unknown_write",
  );
  assert.equal(
    failureCategory("response_schema", { cleanupFailed: true }),
    "cleanup",
  );
  const r = explainBlockers([
    { code: "synthetic-private-token-value" },
    { code: "generation_unsatisfied_or_budget" },
  ]);
  assert.equal(JSON.stringify(r).includes("synthetic-private"), false);
  assert.equal(r.blocked_is_passed, false);
});

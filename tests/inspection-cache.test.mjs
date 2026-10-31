import test from "node:test";
import assert from "node:assert/strict";
import { ProjectInspector } from "../platform/inspection-cache.mjs";
import { workflowSource } from "../examples/workflow-fixture.mjs";
test("inspection cache is bounded and protects returned metadata from caller mutation", async () => {
  const cache = new ProjectInspector({ maxEntries: 1 });
  const first = await cache.inspect(workflowSource());
  assert.equal(first.metadata_cache_hit, false);
  first.operations.length = 0;
  const second = await cache.inspect(workflowSource());
  assert.equal(second.metadata_cache_hit, true);
  assert.ok(second.operations.length > 0);
  await cache.inspect(workflowSource(), { seed: 73 });
  assert.equal(cache.stats.entries, 1);
  assert.equal(cache.stats.raw_documents_cached, false);
  assert.equal(
    (await cache.inspect(workflowSource())).metadata_cache_hit,
    false,
  );
  cache.clear();
  assert.equal(cache.stats.bytes, 0);
});
test("cache identity includes complete document and generation budgets, and rejects credential/adaptor options", async () => {
  const cache = new ProjectInspector();
  const a = await cache.inspect(workflowSource(), { limit: 1 });
  const b = await cache.inspect(workflowSource(), { limit: 2 });
  assert.notEqual(a.generated_cases, b.generated_cases);
  assert.equal(b.metadata_cache_hit, false);
  const d = JSON.parse(workflowSource());
  d.info.version = "changed";
  assert.equal(
    (await cache.inspect(JSON.stringify(d), { limit: 1 })).metadata_cache_hit,
    false,
  );
  await assert.rejects(
    cache.inspect(workflowSource(), { credentials: { private: true } }),
  );
  await assert.rejects(
    cache.inspect(workflowSource(), {
      documents: { "https://ref.invalid/x": {} },
    }),
  );
  await assert.rejects(cache.inspect("x".repeat(1048577)));
});
test("concurrent identical inspection shares bounded compilation without sharing mutable results", async () => {
  const c = new ProjectInspector();
  const [a, b] = await Promise.all([
    c.inspect(workflowSource()),
    c.inspect(workflowSource()),
  ]);
  a.operations.length = 0;
  assert.ok(b.operations.length > 0);
  assert.equal(c.stats.inflight, 0);
});
test("clearing an in-flight inspection prevents late cache repopulation", async () => {
  const c = new ProjectInspector();
  const pending = c.inspect(workflowSource());
  c.clear();
  await pending;
  assert.equal(c.stats.entries, 0);
  assert.equal(c.stats.bytes, 0);
});

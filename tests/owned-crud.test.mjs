import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { OwnedCrudEngine } from "../platform/owned-crud.mjs";
import { loadCore } from "../platform/runner.mjs";
import { fixture } from "../examples/fixture.mjs";
await loadCore();
const source = fs.readFileSync(
  new URL("../examples/spec.json", import.meta.url),
  "utf8",
);
const options = { allowWrite: true, shrinkWrite: true, shrinkBudget: 32 };
test("no model and no reset endpoint: owned CRUD preserves preexisting resources", async () => {
  const s = await fixture();
  s.items.set(90000, { id: 90000, name: "private-sentinel" });
  try {
    const r = await new OwnedCrudEngine(source, options).runCrud(
      s.base,
      "/items",
      "name",
      { allowCleanup: true },
    );
    assert.equal(r.complete, true);
    assert.equal(r.executed, 6);
    assert.equal(r.cleanup_verified, true);
    assert.equal(s.items.size, 1);
    assert.equal(s.items.get(90000).name, "private-sentinel");
    assert.equal(s.resets, 0);
    assert.equal(r.global_business_isolation, false);
    assert.ok(!JSON.stringify(r).includes("moonapi_"));
  } finally {
    await s.close();
  }
});
test("owned resource replay confirms and shrinks lost-update without resetting shared data", async () => {
  const s = await fixture({ staleUpdate: true });
  s.items.set(90000, { id: 90000, name: "sentinel" });
  try {
    const r = await new OwnedCrudEngine(source, options).runCrud(
      s.base,
      "/items",
      "name",
      { allowCleanup: true, saveRepro: true },
    );
    assert.equal(r.property_failure_confirmed, true);
    assert.equal(r.minimized_steps, 3);
    assert.equal(r.cleanup_verified, true);
    assert.equal(s.items.size, 1);
    assert.equal(s.resets, 0);
    assert.deepEqual(
      r.reproduction.model.steps.map((s) => s.id),
      ["create", "update", "readback"],
    );
  } finally {
    await s.close();
  }
});
test("ignored delete reports a failure AND unverified cleanup, never green", async () => {
  const s = await fixture({ ignoreDelete: true });
  try {
    const r = await new OwnedCrudEngine(source, options).runCrud(
      s.base,
      "/items",
      "name",
      { allowCleanup: true },
    );
    assert.equal(r.complete, false);
    assert.equal(r.failed, 1);
    assert.equal(r.cleanup_verified, false);
    assert.equal(r.property_failure_confirmed, false);
    assert.equal(r.remaining_owned_count, 1);
  } finally {
    await s.close();
  }
});
test("ownership drift blocks mutations and cleanup without deleting foreign data", async () => {
  const s = await fixture({ ownershipDrift: true });
  try {
    const r = await new OwnedCrudEngine(source, options).runCrud(
      s.base,
      "/items",
      "name",
      { allowCleanup: true },
    );
    assert.equal(r.complete, false);
    assert.equal(r.property_failure_confirmed, false);
    assert.equal(s.items.size, 1);
  } finally {
    await s.close();
  }
});
test("CRUD permission and profile failures happen before HTTP", async () => {
  const s = await fixture();
  try {
    for (const [o, cfg] of [
      [{}, { allowCleanup: true }],
      [options, {}],
      [options, { allowCleanup: "yes" }],
    ])
      await assert.rejects(
        new OwnedCrudEngine(source, o).runCrud(s.base, "/items", "name", cfg),
      );
    const e = new OwnedCrudEngine(source, options);
    for (const [collection, field] of [
      ["/items", "id"],
      ["/items", "absent"],
      ["/none", "name"],
    ])
      assert.throws(() => e.planCrud(collection, field));
    // Generated client IDs can turn a create into an accidental upsert.
    const unsafe = JSON.parse(source);
    unsafe.paths["/items"].post.requestBody.content[
      "application/json"
    ].schema.properties.id = { type: "integer" };
    assert.throws(() =>
      new OwnedCrudEngine(JSON.stringify(unsafe), options).planCrud(
        "/items",
        "name",
      ),
    );
    assert.equal(s.requests, 0);
  } finally {
    await s.close();
  }
});
test("concurrent runner reuse is refused and all synthetic resources are cleaned", async () => {
  const s = await fixture({ slow: true });
  try {
    const e = new OwnedCrudEngine(source, options);
    const first = e.runCrud(s.base, "/items", "name", { allowCleanup: true });
    await assert.rejects(
      e.runCrud(s.base, "/items", "name", { allowCleanup: true }),
      /Concurrent/,
    );
    assert.equal((await first).cleanup_verified, true);
    assert.equal(s.items.size, 0);
  } finally {
    await s.close();
  }
});

test("committed create with lost response is uncertain and never retried or guessed for cleanup", async () => {
  const s = await fixture({ loseCreateResponse: true });
  try {
    const r = await new OwnedCrudEngine(source, options).runCrud(
      s.base,
      "/items",
      "name",
      { allowCleanup: true },
    );
    assert.equal(r.complete, false);
    assert.equal(r.unclaimed_write_possible, true);
    assert.equal(r.cleanup_verified, false);
    assert.equal(r.property_failure_confirmed, false);
    assert.equal(s.requests, 1);
    assert.equal(s.items.size, 1);
  } finally {
    await s.close();
  }
});

test("a server returning a preexisting ID cannot authorize mutation of the existing resource", async () => {
  const s = await fixture({ foreignCreateId: true });
  s.items.set(90000, { id: 90000, name: "private-sentinel" });
  try {
    const r = await new OwnedCrudEngine(source, options).runCrud(
      s.base,
      "/items",
      "name",
      { allowCleanup: true },
    );
    assert.equal(r.complete, false);
    assert.equal(r.cleanup_verified, false);
    assert.equal(s.items.get(90000).name, "private-sentinel");
    assert.equal(s.items.size, 2);
  } finally {
    await s.close();
  }
});

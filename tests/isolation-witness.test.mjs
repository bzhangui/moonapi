import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { StandardWorkflow } from "../platform/workflow.mjs";
import { ownedResourceWorkflow } from "../platform/workflow-templates.mjs";
import {
  workflowSource,
  workflowFixture,
} from "../examples/workflow-fixture.mjs";
import { loadEncryptedWitness } from "../platform/private-store.mjs";
import { loadConfirmedWitness } from "../platform/confirmed-witness.mjs";
const owned = () =>
  ownedResourceWorkflow({
    create: "create",
    read: "read",
    update: "update",
    remove: "delete",
  });
test("owned workflow requires cleanup consent, preserves side-effect receipts, and cleans a failed run without resetting the entire backend", async () => {
  const f = await workflowFixture({ fault: "persistence" }),
    e = await StandardWorkflow.open(workflowSource(), { allowWrite: true });
  try {
    await assert.rejects(e.run(f.base, owned()), /CLEANUP_NOT_AUTHORIZED/);
    assert.equal(f.requests, 0);
    const r = await e.run(f.base, owned(), { allowCleanup: true });
    assert.equal(r.category, "defect");
    assert.equal(r.cleanup_verified, true);
    assert.equal(f.remaining, 0);
    assert.ok(r.execution.sent > r.records.length);
  } finally {
    await e.close();
    await f.close();
  }
});
test("foreign ownership is never changed or deleted and cleanup is explicitly unconfirmed", async () => {
  const f = await workflowFixture(),
    e = await StandardWorkflow.open(workflowSource(), { allowWrite: true });
  try {
    const m = owned();
    for (const s of m.steps)
      if (s.ownership) s.ownership.allowed = ["not-the-run-marker"];
    m.cleanup[0].ownership.allowed = ["not-the-run-marker"];
    const r = await e.run(f.base, m, { allowCleanup: true });
    assert.equal(r.passed, false);
    assert.equal(r.cleanup_verified, false);
    assert.equal(f.remaining, 1);
    assert.equal(r.execution.unknown_writes, 0);
  } finally {
    await e.close();
    await f.close();
  }
});
test("only confirmed reduced evidence is exported, encrypted and pinned to model/version/seed", async () => {
  const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "moonapi-confirmed-witness-"),
    ),
    file = path.join(directory, "witness.json"),
    key = randomBytes(32),
    f = await workflowFixture({ fault: "persistence" }),
    e = await StandardWorkflow.open(workflowSource(), {
      allowWrite: true,
      seed: 73,
    });
  try {
    const r = await e.run(f.base, owned(), {
      allowCleanup: true,
      reset: f.reset,
      allowReset: true,
      shrink: true,
      witnessFile: file,
      witnessKey: key,
    });
    assert.equal(r.shrink_confirmed, true);
    assert.equal(r.witness_saved, true);
    const w = loadEncryptedWitness(file, key);
    assert.equal(w.confirmed, true);
    assert.equal(w.seed, 73);
    assert.equal(w.model.steps.length, 3);
    assert.ok(w.model_hash);
    assert.equal(
      loadConfirmedWitness(file, key, { source: workflowSource() })
        .automatic_write_replay,
      false,
    );
    assert.throws(
      () => loadConfirmedWitness(file, key, { source: "changed" }),
      /PIN_MISMATCH/,
    );
    assert.throws(
      () =>
        loadConfirmedWitness(file, key, {
          source: workflowSource(),
          engineVersion: "another-version",
        }),
      /PIN_MISMATCH/,
    );
  } finally {
    await e.close();
    await f.close();
    fs.rmSync(directory, { recursive: true });
  }
});
test("loss of an explicitly verified isolation lease blocks later mutations", async () => {
  const f = await workflowFixture(),
    e = await StandardWorkflow.open(workflowSource(), { allowWrite: true });
  let verifies = 0,
    released = 0;
  const isolation = {
    version: 1,
    acquire: async () => ({ ttlMs: 5000 }),
    verify: async () => ++verifies < 4,
    release: async () => {
      released++;
      return true;
    },
  };
  try {
    const r = await e.run(f.base, owned(), { allowCleanup: true, isolation });
    assert.equal(r.passed, false);
    assert.ok(f.requests <= 2);
    assert.equal(released, 1);
  } finally {
    await e.close();
    await f.close();
  }
});

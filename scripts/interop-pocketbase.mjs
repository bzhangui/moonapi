// Explicit integration with an independent upstream backend, isolated synthetic DB.
// Does not use existing PocketBase data, credentials, admin accounts or services.
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { OwnedCrudEngine } from "../platform/owned-crud.mjs";
import { StandardWorkflow } from "../platform/workflow.mjs";
import { ownedResourceWorkflow } from "../platform/workflow-templates.mjs";
import { loadCore, saveReport } from "../platform/runner.mjs";
import { pocketbaseSpec } from "../examples/pocketbase/spec.mjs";
const keepFixture = process.argv[4] === "--keep-fixture";
if (
  ![4, 5].includes(process.argv.length) ||
  (process.argv.length === 5 && !keepFixture) ||
  process.argv[2] !== "--pocketbase"
)
  throw new Error(
    "Pass --pocketbase PATH_TO_VERIFIED_UPSTREAM_BINARY [--keep-fixture]",
  );
const binary = fs.realpathSync(process.argv[3]);
if (
  !fs.statSync(binary).isFile() ||
  fs.statSync(binary).size > 200 * 1024 * 1024
)
  throw new Error("Invalid backend binary");
const version = spawnSync(binary, ["--version"], {
  encoding: "utf8",
  timeout: 10000,
  windowsHide: true,
  shell: false,
});
if (version.status !== 0 || !/\b0\.40\.5\b/.test(version.stdout))
  throw new Error("Use pinned PocketBase 0.40.5");
await loadCore();
const privateParent = fileURLToPath(
  new URL("../.local/interop-runs/", import.meta.url),
);
fs.mkdirSync(privateParent, { recursive: true });
const parent = fs.realpathSync(privateParent),
  root = fs.mkdtempSync(path.join(parent, "moonapi-pb-interop-"));
const migration = path.join(root, "migrations");
fs.mkdirSync(migration);
fs.copyFileSync(
  new URL("../examples/pocketbase/migration.js", import.meta.url),
  path.join(migration, "1700000000_fixture.js"),
);
let child, childClosed, base, result;
const stop = async () => {
  if (!child) return;
  if (child.exitCode === null && child.signalCode === null) child.kill();
  let timer;
  try {
    await Promise.race([
      childClosed,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Backend stop timeout")),
          5000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  child = undefined;
};
const request = async (route, init) => {
  const response = await fetch(base + route, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(3000),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};
const start = async () => {
  const reservation = net.createServer();
  await new Promise((resolve, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", resolve);
  });
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  base = `http://127.0.0.1:${port}`;
  child = spawn(
    binary,
    [
      "serve",
      "--http",
      `127.0.0.1:${port}`,
      "--dir",
      path.join(root, "data"),
      "--migrationsDir",
      migration,
    ],
    {
      cwd: root,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  childClosed = new Promise((resolve) => child.once("close", resolve));
  let error = false;
  child.on("error", () => {
    error = true;
  });
  child.stdout.resume();
  child.stderr.resume();
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (error || child.exitCode !== null)
      throw new Error("Owned backend failed to start");
    try {
      const probe = await request("/api/collections/moonapi_notes/records");
      if (probe.status === 200 && Array.isArray(probe.body.items)) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Backend startup deadline");
};
try {
  await start();
  const cases = [];
  for (const [name, field] of [
    ["moonapi_notes", "title"],
    ["moonapi_tasks", "name"],
  ]) {
    const collection = `/api/collections/${name}/records`,
      sentinel = `preexisting-${name}`;
    const created = await request(collection, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ [field]: sentinel }),
    });
    assert.equal(created.status, 200);
    const id = created.body.id;
    for (let round = 0; round < 3; round++) {
      const r = await new OwnedCrudEngine(pocketbaseSpec(name, field), {
        allowWrite: true,
        shrinkWrite: true,
      }).runCrud(base, collection, field, { allowCleanup: true });
      assert.equal(r.complete, true, JSON.stringify(r));
      assert.equal(r.cleanup_verified, true);
      const standard = await StandardWorkflow.open(
        pocketbaseSpec(name, field),
        { allowWrite: true },
      );
      try {
        const sr = await standard.run(
          base,
          ownedResourceWorkflow({
            create: "create",
            read: "read",
            update: "update",
            remove: "delete",
            field,
            initial: `standard-${round}`,
            changed: `updated-${round}`,
          }),
          { allowCleanup: true },
        );
        assert.equal(sr.passed, true, JSON.stringify(sr));
        assert.equal(sr.records.length, 6);
        assert.equal(sr.cleanup_verified, true);
        assert.equal(sr.execution.unknown_writes, 0);
      } finally {
        await standard.close();
      }
      const list = await request(collection);
      assert.equal(list.body.totalItems, 1);
      assert.equal(list.body.items[0].id, id);
      assert.equal(list.body.items[0][field], sentinel);
      cases.push({
        collection: name,
        round,
        executed: r.executed,
        http_requests: r.http_requests,
        cleanup_verified: true,
        sentinel_preserved: true,
        standard_workflow_steps: 6,
      });
    }
  }
  await stop();
  await start();
  for (const [name, field] of [
    ["moonapi_notes", "title"],
    ["moonapi_tasks", "name"],
  ]) {
    const list = await request(`/api/collections/${name}/records`);
    assert.equal(list.body.totalItems, 1);
    assert.equal(list.body.items[0][field], `preexisting-${name}`);
  }
  result = {
    kind: "independent_backend_integration",
    backend: "PocketBase",
    upstream_version: "0.40.5",
    upstream_url:
      "https://github.com/pocketbase/pocketbase/releases/tag/v0.40.5",
    binary_sha256: createHash("sha256")
      .update(fs.readFileSync(binary))
      .digest("hex"),
    synthetic_data: true,
    real_user_pilot: false,
    production_validation: false,
    test_owned_contract_not_upstream_openapi: true,
    cases,
    restart_persistence_verified: true,
    real_database: "SQLite",
    ok: true,
  };
} catch (error) {
  // Preserve a useful primary diagnosis even when Windows refuses cleanup.
  console.error("Independent backend verification failed: " + error.message);
  throw error;
} finally {
  // Do not remove fixtures if an owned process has not actually exited.
  await stop();
  assert.equal(path.dirname(root), parent);
  assert.ok(path.basename(root).startsWith("moonapi-pb-interop-"));
  assert.equal(fs.lstatSync(root).isSymbolicLink(), false);
  if (!keepFixture)
    fs.rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
}
result.temporary_process_removed = true;
result.synthetic_fixture_retained = keepFixture;
result.temporary_data_removed = !keepFixture;
console.log(JSON.stringify({ ...result, report: saveReport(result) }));

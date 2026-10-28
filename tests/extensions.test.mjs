import test from "node:test";
import assert from "node:assert/strict";
import { probeTransportAdapter } from "../platform/adapter-conformance.mjs";
import { migrateWorkflow } from "../platform/workflow-migration.mjs";
import { StandardWorkflow } from "../platform/workflow.mjs";
import { resourceWorkflow } from "../platform/workflow-templates.mjs";
import { workflowSource } from "../examples/workflow-fixture.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
test("adapter contract probes remain read-only, refuse malformed responses and retain explicit target grants", async () => {
  let sent = 0;
  const transport = {
    version: 1,
    id: "synthetic",
    send: async (_, request) => {
      sent++;
      assert.equal(request.method, "GET");
      return { status: 200, headers: {}, raw: Buffer.alloc(0) };
    },
  };
  const r = await probeTransportAdapter(transport, "http://127.0.0.1:1");
  assert.equal(r.passed, true);
  assert.equal(sent, 1);
  assert.equal(r.production_certified, false);
  await assert.rejects(
    probeTransportAdapter(transport, "https://not-authorized.invalid"),
  );
  await assert.rejects(
    probeTransportAdapter(
      { version: 1, id: "invalid", send: async () => ({ status: 999 }) },
      "http://127.0.0.1:1",
    ),
  );
});
test("IR migration is explicit, validated, idempotent and never invents state preconditions or grants", async () => {
  const e = await StandardWorkflow.open(workflowSource());
  try {
    const v1 = resourceWorkflow({
        create: "create",
        read: "read",
        update: "update",
        remove: "delete",
      }),
      result = migrateWorkflow(v1, e.description);
    assert.equal(v1.version, 1);
    assert.equal(result.to, 2);
    assert.equal(result.automatic_execution, false);
    assert.deepEqual(result.model.steps, v1.steps);
    assert.deepEqual(result.model.initial_state, {});
    assert.deepEqual(
      migrateWorkflow(result.model, e.description).model,
      result.model,
    );
    assert.throws(
      () => migrateWorkflow({ ...v1, version: 3 }, e.description),
      /VERSION/,
    );
    assert.throws(() =>
      migrateWorkflow({ ...v1, unexpected: true }, e.description),
    );
  } finally {
    await e.close();
  }
});
test("offline signing CLI checks the runtime file set and a separately supplied key, with no overwrite or publication", () => {
  const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "moonapi-signing-cli-"),
    ),
    bundle = path.join(directory, "bundle");
  try {
    fs.mkdirSync(bundle);
    const pair = generateKeyPairSync("ed25519"),
      privateFile = path.join(directory, "synthetic-private.pem"),
      publicFile = path.join(directory, "synthetic-public.pem"),
      sidecar = path.join(directory, "signature.json"),
      version = JSON.parse(
        fs.readFileSync(new URL("../package.json", import.meta.url)),
      ).version;
    fs.writeFileSync(
      privateFile,
      pair.privateKey.export({ type: "pkcs8", format: "pem" }),
      { mode: 0o600 },
    );
    fs.writeFileSync(
      publicFile,
      pair.publicKey.export({ type: "spki", format: "pem" }),
    );
    fs.writeFileSync(path.join(bundle, "payload.txt"), "synthetic only");
    fs.writeFileSync(
      path.join(bundle, "manifest.json"),
      JSON.stringify({
        format: 1,
        name: "MoonAPI",
        version,
        files: {
          "payload.txt": createHash("sha256")
            .update("synthetic only")
            .digest("hex"),
        },
      }),
    );
    const run = (action, key, output = sidecar) =>
      spawnSync(
        process.execPath,
        [
          fileURLToPath(
            new URL("../scripts/sign-manifest.mjs", import.meta.url),
          ),
          action,
          bundle,
          key,
          output,
        ],
        { encoding: "utf8", timeout: 10000 },
      );
    assert.equal(run("sign", privateFile).status, 0);
    assert.equal(run("verify", publicFile).status, 0);
    assert.notEqual(run("sign", privateFile).status, 0);
    assert.notEqual(
      run("sign", privateFile, path.join(bundle, "signature.json")).status,
      0,
    );
    fs.writeFileSync(path.join(bundle, "payload.txt"), "tampered");
    const invalid = run("verify", publicFile);
    assert.notEqual(invalid.status, 0);
    assert.ok(!invalid.stderr.includes(directory));
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

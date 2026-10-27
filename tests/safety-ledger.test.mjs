import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  ExecutionLedger,
  recoverLedger,
} from "../platform/execution-ledger.mjs";
import {
  atomicPrivate,
  saveEncryptedWitness,
  loadEncryptedWitness,
} from "../platform/private-store.mjs";
import { randomBytes } from "node:crypto";
import { StandardWorkflow } from "../platform/workflow.mjs";
import {
  workflowSource,
  workflowFixture,
} from "../examples/workflow-fixture.mjs";
import { resourceWorkflow } from "../platform/workflow-templates.mjs";
import { publicReport } from "../platform/ci-tools.mjs";
const resource = () =>
  resourceWorkflow({
    create: "create",
    read: "read",
    update: "update",
    remove: "delete",
  });
test("lost response preserves the sent request, unknown write, and nonzero public execution count", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "moonapi-ledger-")),
    f = await workflowFixture({ fault: "committed_response_lost" }),
    e = await StandardWorkflow.open(workflowSource(), { allowWrite: true });
  try {
    const r = await e.run(f.base, resource(), { journalDirectory: directory });
    assert.equal(r.category, "transport");
    assert.equal(f.requests, 1);
    assert.equal(f.creates, 1);
    assert.equal(r.records.length, 1);
    assert.equal(publicReport(r).executed, 1);
    assert.equal(r.execution.dispatched, 1);
    assert.equal(r.execution.unknown_writes, 1);
    const file = path.join(directory, fs.readdirSync(directory)[0]),
      recovery = await recoverLedger(file);
    assert.equal(recovery.unknown_writes, 1);
    assert.equal(recovery.automatic_replay_permitted, false);
    assert.ok(!fs.readFileSync(file, "utf8").includes("owned"));
    assert.ok(!fs.readFileSync(file, "utf8").includes(f.base));
  } finally {
    await e.close();
    await f.close();
    fs.rmSync(directory, { recursive: true });
  }
});
test("ledger rejects impossible transitions and detects corruption, while a torn tail never authorizes replay", async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "moonapi-ledger-integrity-"),
  );
  try {
    const ledger = await ExecutionLedger.open({ directory, runId: "control" }),
      meta = { method: "POST", operation_id: "private-name" };
    assert.throws(() => ledger.event(1, "completed", meta), /TRANSITION/);
    ledger.event(1, "prepared", meta);
    ledger.event(1, "dispatching", meta);
    ledger.close();
    fs.appendFileSync(ledger.file, '{"partial":');
    const recovered = await recoverLedger(ledger.file);
    assert.equal(recovered.torn_tail, true);
    assert.equal(recovered.unknown_writes, 1);
    const original = fs.readFileSync(ledger.file, "utf8");
    fs.writeFileSync(ledger.file, original.replace("POST", "GET"));
    await assert.rejects(recoverLedger(ledger.file), /CORRUPT/);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});
test("atomic private artifacts refuse overwrite and authenticated witnesses detect alteration and wrong keys", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "moonapi-witness-")),
    file = path.join(directory, "witness.json"),
    key = randomBytes(32);
  try {
    const witness = { format: 2, model: { secret: "PRIVATE_TEST_VALUE" } };
    saveEncryptedWitness(file, witness, key);
    assert.ok(!fs.readFileSync(file, "utf8").includes("PRIVATE_TEST_VALUE"));
    assert.deepEqual(loadEncryptedWitness(file, key), witness);
    assert.throws(() => saveEncryptedWitness(file, witness, key));
    assert.throws(
      () => loadEncryptedWitness(file, randomBytes(32)),
      /AUTHENTICATION/,
    );
    const envelope = JSON.parse(fs.readFileSync(file, "utf8"));
    envelope.tag = Buffer.alloc(16).toString("base64");
    fs.writeFileSync(file, JSON.stringify(envelope));
    assert.throws(() => loadEncryptedWitness(file, key));
    assert.throws(
      () =>
        atomicPrivate(path.join(directory, "big"), "x".repeat(32), {
          maxBytes: 8,
        }),
      /BUDGET/,
    );
    assert.equal(
      fs.readdirSync(directory).filter((x) => x.endsWith(".tmp")).length,
      0,
    );
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});
test("ledger fsync receipts survive an abruptly terminated dedicated child process", async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "moonapi-ledger-kill-"),
  );
  try {
    const source = `import {ExecutionLedger} from ${JSON.stringify(new URL("../platform/execution-ledger.mjs", import.meta.url).href)};const l=await ExecutionLedger.open({directory:${JSON.stringify(directory)},runId:'killed'});l.event(1,'prepared',{method:'POST'});l.event(1,'dispatching',{method:'POST'});console.log('READY');setInterval(()=>{},1000);`;
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", source],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("child deadline"));
      }, 10000);
      child.stdout.once("data", () => {
        clearTimeout(timer);
        resolve();
      });
      child.once("error", reject);
    });
    const exited = new Promise((r) => child.once("exit", r));
    child.kill("SIGKILL");
    await exited;
    const r = await recoverLedger(path.join(directory, "killed.jsonl"));
    assert.equal(r.unknown_writes, 1);
    assert.equal(r.automatic_replay_permitted, false);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});
test("monotonic workflow budget is not extended by wall-clock rollback", async () => {
  const f = await workflowFixture({ delay: 250 }),
    e = await StandardWorkflow.open(workflowSource(), { allowWrite: true }),
    saved = Date.now;
  try {
    Date.now = () => 0;
    const r = await e.run(f.base, resource(), { totalTimeout: 100 });
    assert.equal(r.category, "budget");
    assert.equal(f.requests <= 1, true);
  } finally {
    Date.now = saved;
    await e.close();
    await f.close();
  }
});

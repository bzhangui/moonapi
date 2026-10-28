import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, generateKeyPairSync } from "node:crypto";
import {
  ExecutionIntentStore,
  intentEnvironmentBinding,
} from "../platform/execution-intent.mjs";
import { documentDigest } from "../platform/ci-tools.mjs";
import { digestExact } from "../platform/private-store.mjs";
import { StandardEngine } from "../platform/standard.mjs";
import {
  workflowSource,
  workflowFixture,
} from "../examples/workflow-fixture.mjs";
import {
  ExecutionLedger,
  recoverLedger,
  recoverSegmentedLedger,
} from "../platform/execution-ledger.mjs";
import { fencedSQLiteFixture } from "../examples/fenced-sqlite.mjs";
import { standardHTTP } from "../platform/standard-http.mjs";
import { signArtifact, verifyArtifact } from "../platform/signed-artifact.mjs";
import http from "node:http";
const temporary = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), "moonapi-upgrade-"));
test("encrypted intent is durable before a lost write, has no body or bearer, and never replays", async () => {
  const dir = temporary(),
    f = await workflowFixture({ fault: "committed_response_lost" }),
    source = workflowSource();
  const store = new ExecutionIntentStore({
    directory: dir,
    key: randomBytes(32),
    environmentBinding: intentEnvironmentBinding(f.base),
    documentBinding: documentDigest(source),
    modelBinding: digestExact({ model: "controlled" }),
    ownershipMarker: "PRIVATE_OWNER_MARKER",
  });
  const e = await StandardEngine.open(source, {
    allowWrite: true,
    intentStore: store,
  });
  try {
    const r = await e.execute(f.base, {
      operation_id: "create",
      parameters: [],
      negative: false,
      media: "application/json",
      body: { name: "PRIVATE_BODY" },
    });
    assert.equal(r.record.category, "transport");
    assert.equal(f.creates, 1);
    const files = fs.readdirSync(dir);
    assert.equal(files.length, 1);
    const raw = fs.readFileSync(path.join(dir, files[0]), "utf8");
    for (const hidden of [
      "PRIVATE_BODY",
      "PRIVATE_OWNER_MARKER",
      f.base,
      "create",
    ])
      assert.ok(!raw.includes(hidden));
    const intent = store.inspect(files[0].replace(".intent.json", ""));
    assert.equal(intent.method, "POST");
    const inspect = async (receipt) =>
      store.reconcile(intent.id, {
        version: 1,
        inspect: async () => ({
          request_digest: intent.request_digest,
          environment_binding: intent.environment_binding,
          ...receipt,
        }),
      });
    assert.equal(
      (await inspect({ state: "not_committed", status: 404 })).state,
      "still_unknown",
    );
    assert.equal(
      (await inspect({ state: "not_committed", authoritative: true })).state,
      "authoritatively_not_committed",
    );
    assert.equal(
      (await inspect({ state: "committed" })).state,
      "observed_committed",
    );
    assert.equal(
      (await inspect({ state: "committed", request_digest: "0".repeat(64) }))
        .state,
      "still_unknown",
    );
    await assert.rejects(
      store.reconcile(
        intent.id,
        { version: 1, inspect: () => new Promise(() => {}) },
        { timeout: 20 },
      ),
      /DEADLINE/,
    );
    assert.equal(f.creates, 1);
    assert.equal(intent.automatic_replay_permitted, false);
  } finally {
    await e.close();
    await f.close();
    store.close();
    fs.rmSync(dir, { recursive: true });
  }
});
test("failed or misbound intent persistence prevents dispatch; reads do not require intent writes", async () => {
  const f = await workflowFixture();
  let prepared = 0;
  const e = await StandardEngine.open(workflowSource(), {
    allowWrite: true,
    intentStore: {
      version: 1,
      prepare: () => {
        prepared++;
        throw new Error("PRIVATE_DISK_FAILURE");
      },
    },
  });
  try {
    const r = await e.execute(f.base, {
      operation_id: "create",
      parameters: [],
      negative: false,
      media: "application/json",
      body: { name: "sample" },
    });
    assert.equal(r.record, undefined);
    assert.equal(f.creates, 0);
    assert.equal(prepared, 1);
    assert.ok(!JSON.stringify(r).includes("PRIVATE_DISK_FAILURE"));
    await e.execute(f.base, {
      operation_id: "health",
      parameters: [],
      negative: false,
    });
    assert.equal(prepared, 1);
  } finally {
    await e.close();
    await f.close();
  }
});
test("authenticated segmented ledger detects tamper, gaps, cross-run substitution and checkpoint truncation", async () => {
  const directory = temporary(),
    key = randomBytes(32);
  const ledger = await ExecutionLedger.open({
    directory,
    runId: "segmented",
    authKey: key,
    segmentBytes: 1024,
  });
  try {
    let final;
    for (let i = 1; i <= 12; i++)
      for (const state of ["prepared", "dispatching", "sent", "unknown"])
        final = ledger.event(i, state, { method: "POST" }).hash;
    ledger.close();
    const recovered = await recoverSegmentedLedger(directory, "segmented", {
      authKey: key,
      expectedFinalHash: final,
    });
    assert.equal(recovered.unknown_writes, 12);
    assert.ok(recovered.segments > 1);
    assert.match(recovered.integrity, /hmac/);
    await assert.rejects(
      recoverSegmentedLedger(directory, "segmented"),
      /AUTH/,
    );
    await assert.rejects(
      recoverSegmentedLedger(directory, "segmented", {
        authKey: randomBytes(32),
      }),
      /AUTH/,
    );
    await assert.rejects(
      recoverSegmentedLedger(directory, "segmented", {
        authKey: key,
        expectedFinalHash: "0".repeat(64),
      }),
      /CHECKPOINT/,
    );
    const names = fs.readdirSync(directory).sort(),
      last = names.filter((n) => n !== "segmented.jsonl").at(-1);
    const finalFile = path.join(directory, last),
      original = fs.readFileSync(finalFile, "utf8");
    fs.appendFileSync(finalFile, '{"partial"');
    assert.equal(
      (await recoverSegmentedLedger(directory, "segmented", { authKey: key }))
        .torn_tail,
      true,
    );
    fs.writeFileSync(finalFile, original.replace("POST", "GET"));
    await assert.rejects(
      recoverSegmentedLedger(directory, "segmented", { authKey: key }),
      /AUTH|CORRUPT/,
    );
    fs.writeFileSync(finalFile, original);
    fs.unlinkSync(path.join(directory, "segmented.0001.jsonl"));
    await assert.rejects(
      recoverSegmentedLedger(directory, "segmented", { authKey: key }),
      /SEGMENTS/,
    );
  } finally {
    ledger.close();
    fs.rmSync(directory, { recursive: true });
  }
});
test("legacy recovery rejects malformed envelopes and remains inspect only", async () => {
  const directory = temporary(),
    l = await ExecutionLedger.open({ directory });
  try {
    l.event(1, "prepared", { method: "GET" });
    l.close();
    fs.appendFileSync(l.file, "null\n");
    await assert.rejects(recoverLedger(l.file), /CORRUPT/);
  } finally {
    l.close();
    fs.rmSync(directory, { recursive: true });
  }
});
test("rotation collisions fail closed without overwriting a segment or silently switching to memory-only logging", async () => {
  const directory = temporary(),
    l = await ExecutionLedger.open({
      directory,
      runId: "collision",
      segmentBytes: 1024,
    });
  try {
    const next = path.join(directory, "collision.0001.jsonl");
    fs.writeFileSync(next, "synthetic occupied file");
    assert.throws(() => {
      for (let i = 1; i < 10; i++) l.event(i, "prepared", { method: "POST" });
    }, /EEXIST/);
    assert.throws(() => l.event(10, "prepared", { method: "POST" }), /CLOSED/);
    assert.equal(fs.readFileSync(next, "utf8"), "synthetic occupied file");
  } finally {
    l.close();
    fs.rmSync(directory, { recursive: true });
  }
});
test("whole-record deletion needs the separately stored final checkpoint to detect a valid-prefix rollback", async () => {
  const directory = temporary(),
    key = randomBytes(32),
    l = await ExecutionLedger.open({ directory, authKey: key });
  try {
    l.event(1, "prepared", { method: "POST" });
    const final = l.event(1, "dispatching", { method: "POST" }).hash;
    l.close();
    fs.writeFileSync(
      l.file,
      fs.readFileSync(l.file, "utf8").split("\n")[0] + "\n",
    );
    assert.equal((await recoverLedger(l.file, { authKey: key })).attempts, 1);
    await assert.rejects(
      recoverLedger(l.file, { authKey: key, expectedFinalHash: final }),
      /CHECKPOINT/,
    );
  } finally {
    l.close();
    fs.rmSync(directory, { recursive: true });
  }
});
test("server-side SQLite fencing rejects an expired in-flight owner and a stale release cannot revoke its successor", async () => {
  const directory = temporary(),
    f = await fencedSQLiteFixture(directory, { ttlMs: 1000 });
  try {
    const first = f.acquire(),
      send = (token) =>
        standardHTTP(new URL(f.base + "/?tenant=" + token.owner), {
          method: "POST",
          headers: {
            "x-fence-epoch": String(token.epoch),
            "x-fence-owner": token.owner,
          },
          signal: AbortSignal.timeout(2000),
        });
    assert.equal((await send(first)).status, 204);
    // Start before expiry, hold its final body byte, then acquire a successor
    // before allowing the old request to enter its database transaction.
    const pending = http.request(f.base + "/?tenant=" + first.owner, {
      method: "POST",
      headers: {
        "content-length": "1",
        "x-fence-epoch": String(first.epoch),
        "x-fence-owner": first.owner,
      },
    });
    const pendingResult = new Promise((resolve, reject) => {
      pending.once("response", (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      pending.once("error", reject);
    });
    pending.setTimeout(5000, () =>
      pending.destroy(new Error("synthetic timeout")),
    );
    pending.flushHeaders();
    const waitStart = performance.now();
    while (f.requests < 2 && performance.now() - waitStart < 500)
      await new Promise((r) => setTimeout(r, 5));
    assert.equal(f.requests, 2);
    await new Promise((r) => setTimeout(r, 1050));
    assert.equal((await send(first)).status, 409);
    const second = f.acquire();
    assert.ok(second.epoch > first.epoch);
    pending.end("x");
    assert.equal(await pendingResult, 409);
    await f.adapter.release(first);
    assert.equal(await f.adapter.verify(second), true);
    assert.equal((await send(second)).status, 204);
    const cross = await standardHTTP(
      new URL(f.base + "/?tenant=" + first.owner),
      {
        method: "POST",
        headers: {
          "x-fence-epoch": String(second.epoch),
          "x-fence-owner": second.owner,
        },
        signal: AbortSignal.timeout(2000),
      },
    );
    assert.equal(cross.status, 409);
  } finally {
    await f.close();
    fs.rmSync(directory, { recursive: true });
  }
});
test("artifact signatures require a separately trusted Ed25519 key and detect metadata mutation", () => {
  const pair = generateKeyPairSync("ed25519"),
    other = generateKeyPairSync("ed25519");
  const privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" }),
    publicKey = pair.publicKey.export({ type: "spki", format: "pem" }),
    bytes = Buffer.from('{"source":"synthetic"}'),
    signature = signArtifact(bytes, privateKey);
  assert.equal(verifyArtifact(bytes, signature, publicKey), true);
  assert.equal(
    verifyArtifact(
      Buffer.concat([bytes, Buffer.from("x")]),
      signature,
      publicKey,
    ),
    false,
  );
  assert.equal(
    verifyArtifact(
      bytes,
      signature,
      other.publicKey.export({ type: "spki", format: "pem" }),
    ),
    false,
  );
  assert.equal(
    verifyArtifact(
      bytes,
      { ...signature, identity_certified: true },
      publicKey,
    ),
    false,
  );
});

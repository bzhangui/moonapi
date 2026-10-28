import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { StandardWorkflow } from "../platform/workflow.mjs";
import {
  ExecutionIntentStore,
  intentEnvironmentBinding,
} from "../platform/execution-intent.mjs";
import { documentDigest } from "../platform/ci-tools.mjs";
import { digestExact } from "../platform/private-store.mjs";
import { ownedResourceWorkflow } from "../platform/workflow-templates.mjs";
import { workflowFixture, workflowSource } from "./workflow-fixture.mjs";
import { recoverSegmentedLedger } from "../platform/execution-ledger.mjs";
const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "moonapi-recovery-demo-"),
  ),
  intents = path.join(directory, "intents"),
  journals = path.join(directory, "journals"),
  f = await workflowFixture({ fault: "committed_response_lost" }),
  source = workflowSource(),
  model = ownedResourceWorkflow({
    create: "create",
    read: "read",
    update: "update",
    remove: "delete",
  }),
  key = randomBytes(32),
  store = new ExecutionIntentStore({
    directory: intents,
    key,
    environmentBinding: intentEnvironmentBinding(f.base),
    documentBinding: documentDigest(source),
    modelBinding: digestExact(model),
    ownershipMarker: "synthetic-demo-only",
  });
let engine;
try {
  engine = await StandardWorkflow.open(source, {
    allowWrite: true,
    intentStore: store,
  });
  const report = await engine.run(f.base, model, {
      allowCleanup: true,
      journalDirectory: journals,
      journalOptions: { authKey: key, segmentBytes: 2048 },
    }),
    id = fs
      .readdirSync(intents)
      .find((n) => n.endsWith(".intent.json"))
      .replace(".intent.json", ""),
    intent = store.inspect(id),
    disposition = await store.reconcile(id, {
      version: 1,
      inspect: async () => ({
        state: f.creates === 1 ? "committed" : "unknown",
        request_digest: intent.request_digest,
        environment_binding: intent.environment_binding,
      }),
    }),
    run = fs
      .readdirSync(journals)
      .find((n) => !/\.\d{4}\.jsonl$/.test(n))
      .slice(0, -6),
    recovery = await recoverSegmentedLedger(journals, run, { authKey: key });
  if (
    report.execution.unknown_writes !== 1 ||
    f.creates !== 1 ||
    disposition.state !== "observed_committed" ||
    recovery.unknown_writes !== 1
  )
    throw new Error("RECOVERY_DEMO_FAILED");
  console.log(
    JSON.stringify({
      synthetic_demo: true,
      real_user_validation: false,
      sent_once: true,
      encrypted_intent: true,
      authenticated_ledger: true,
      reconciled: disposition.state,
      automatic_replay_permitted: false,
      manual_handoff_required: true,
      private_fixtures_removed_on_exit: true,
    }),
  );
} finally {
  await engine?.close();
  await f.close();
  store.close();
  key.fill(0);
  // Exact directory created for this invocation, not a user data directory.
  fs.rmSync(directory, { recursive: true });
}

import test from "node:test";
import assert from "node:assert/strict";
import { scopedCredentials } from "../platform/scoped-credentials.mjs";
import { within } from "../platform/adapters.mjs";
import { StandardEngine } from "../platform/standard.mjs";
import { documentDigest } from "../platform/ci-tools.mjs";
import { intentEnvironmentBinding } from "../platform/execution-intent.mjs";
import {
  workflowFixture,
  workflowSource,
} from "../examples/workflow-fixture.mjs";
test("credential scope denies document, environment, role and operation changes before invoking provider", async () => {
  let calls = 0;
  const scope = {
    documentBinding: "a".repeat(64),
    environmentBinding: "b".repeat(64),
    roles: ["reader"],
    operations: ["read"],
  };
  const p = scopedCredentials(
    {
      version: 1,
      async resolve() {
        calls++;
        return {};
      },
    },
    scope,
  );
  const context = {
    documentBinding: scope.documentBinding,
    environmentBinding: scope.environmentBinding,
    role: "reader",
    operation_id: "read",
  };
  for (const bad of [
    { role: "admin" },
    { operation_id: "delete" },
    { documentBinding: "c".repeat(64) },
    { environmentBinding: "d".repeat(64) },
    { signal: AbortSignal.abort() },
  ])
    await assert.rejects(p.resolve({ ...context, ...bad }), /DENIED/);
  assert.equal(calls, 0);
  assert.deepEqual(await p.resolve(context), {});
  assert.equal(calls, 1);
});
test("cancellation between adapter scheduling and dispatch cannot invoke the action", async () => {
  let calls = 0;
  const c = new AbortController();
  const pending = within(c.signal, () => {
    calls++;
    return true;
  });
  c.abort();
  await assert.rejects(pending);
  assert.equal(calls, 0);
});
test("real StandardEngine supplies scope bindings to a credential extension", async () => {
  const f = await workflowFixture(),
    source = workflowSource();
  let calls = 0;
  const credentialProvider = scopedCredentials(
    {
      version: 1,
      async resolve() {
        calls++;
        return {};
      },
    },
    {
      documentBinding: documentDigest(source),
      environmentBinding: intentEnvironmentBinding(f.base),
      roles: ["default"],
      operations: ["health"],
    },
  );
  const e = await StandardEngine.open(source, { credentialProvider });
  try {
    const r = await e.runSelected(f.base, { operationIds: ["health"] });
    assert.equal(r.passed, true);
    assert.ok(calls > 0);
  } finally {
    await e.close();
    await f.close();
  }
});

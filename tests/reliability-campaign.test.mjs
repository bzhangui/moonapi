import test from "node:test";
import assert from "node:assert/strict";
import { StandardEngine } from "../platform/standard.mjs";
import { StandardWorkflow } from "../platform/workflow.mjs";
import { protectedOwnedWorkflow } from "../platform/workflow-templates.mjs";
import {
  workflowFixture,
  workflowSource,
} from "../examples/workflow-fixture.mjs";
import { standardHTTP } from "../platform/standard-http.mjs";
import { publicReport } from "../platform/ci-tools.mjs";
for (const status of [401, 403, 429, 503])
  test(
    "controlled status " + status + " cannot become a successful positive read",
    async () => {
      const e = await StandardEngine.open(workflowSource(), {
        transport: {
          version: 1,
          id: "synthetic-status",
          async send() {
            return { status, headers: {}, raw: Buffer.alloc(0) };
          },
        },
      });
      try {
        const r = await e.runSelected("http://127.0.0.1:1", {
          operationIds: ["health"],
        });
        assert.equal(r.passed, false);
        assert.ok(r.records.some((x) => !x.passed));
      } finally {
        await e.close();
      }
    },
  );
test("committed response loss plus enabled shrink and cleanup halts all later side effects", async () => {
  const f = await workflowFixture({ fault: "committed_response_lost" });
  let calls = 0;
  const e = await StandardWorkflow.open(workflowSource(), {
    allowWrite: true,
    transport: {
      version: 1,
      id: "controlled-response-loss",
      async send(url, request) {
        calls++;
        return standardHTTP(url, request);
      },
    },
  });
  try {
    const r = await e.run(
      f.base,
      protectedOwnedWorkflow({
        create: "create",
        read: "read",
        update: "update",
        remove: "delete",
      }),
      { shrink: true, allowCleanup: true },
    );
    assert.equal(r.passed, false);
    assert.equal(r.execution.unknown_writes, 1);
    assert.equal(calls, 1);
    assert.equal(f.creates, 1);
    assert.equal(r.shrink_confirmed, false);
    assert.notEqual(r.cleanup_verified, true);
  } finally {
    await e.close();
    await f.close();
  }
});
test("oversized adapter output and credential expiry fail closed without exposing raw secrets", async () => {
  for (const mode of ["oversized", "credentials"]) {
    let sends = 0;
    const e = await StandardEngine.open(workflowSource(), {
      ...(mode === "credentials"
        ? {
            credentialProvider: {
              version: 1,
              async resolve() {
                throw new Error("synthetic-private-credential");
              },
            },
          }
        : {}),
      transport: {
        version: 1,
        id: "controlled-resource-limit",
        async send() {
          sends++;
          return { status: 200, headers: {}, raw: Buffer.alloc(1048577) };
        },
      },
    });
    try {
      const r = await e.runSelected("http://127.0.0.1:1", {
        operationIds: ["health"],
      });
      assert.equal(r.passed, false);
      assert.equal(
        JSON.stringify(publicReport(r)).includes("synthetic-private"),
        false,
      );
      if (mode === "credentials") assert.equal(sends, 0);
    } finally {
      await e.close();
    }
  }
});

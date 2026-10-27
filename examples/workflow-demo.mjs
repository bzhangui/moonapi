import assert from "node:assert/strict";
import { StandardWorkflow } from "../platform/workflow.mjs";
import {
  resourceWorkflow,
  asyncWorkflow,
} from "../platform/workflow-templates.mjs";
import { workflowFixture, workflowSource } from "./workflow-fixture.mjs";
for (const fault of ["", "persistence"]) {
  const fixture = await workflowFixture({ fault }),
    engine = await StandardWorkflow.open(workflowSource(), {
      allowWrite: true,
    });
  try {
    const result = await engine.run(
      fixture.base,
      resourceWorkflow({
        create: "create",
        read: "read",
        update: "update",
        remove: "delete",
      }),
      { reset: fixture.reset, allowReset: true, shrink: !!fault },
    );
    assert.equal(result.passed, !fault);
    if (fault) assert.equal(result.shrink_confirmed, true);
    console.log(
      JSON.stringify({
        controlled: true,
        fault: fault || "healthy",
        passed: result.passed,
        original: result.original_steps,
        retained: result.retained_step_ids.length,
        confirmed: result.shrink_confirmed,
      }),
    );
    if (!fault)
      assert.equal(
        (
          await engine.run(
            fixture.base,
            asyncWorkflow({ submit: "submit", poll: "poll" }),
          )
        ).passed,
        true,
      );
  } finally {
    await engine.close();
    await fixture.close();
  }
}

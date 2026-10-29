import { workflowFixture, workflowSource } from "./workflow-fixture.mjs";
import { protectedOwnedWorkflow } from "../platform/workflow-templates.mjs";
import { StandardWorkflow } from "../platform/workflow.mjs";
import { publicReport } from "../platform/ci-tools.mjs";
const f = await workflowFixture({ fault: "persistence" }),
  e = await StandardWorkflow.open(workflowSource(), { allowWrite: true });
try {
  const model = protectedOwnedWorkflow({
    create: "create",
    read: "read",
    update: "update",
    remove: "delete",
  });
  model.steps[0].request.body.extra = { note: "irrelevant synthetic payload" };
  model.steps[0].shrink_inputs = ["$request.body"];
  const report = await e.run(f.base, model, {
    allowCleanup: true,
    shrink: true,
  });
  if (
    !report.shrink_confirmed ||
    !report.input_shrink_attempts ||
    !report.cleanup_verified ||
    f.remaining
  )
    throw new Error("OWNED_REDUCTION_DEMO_FAILED");
  console.log(
    JSON.stringify({
      synthetic: true,
      global_reset: false,
      input_shrunk: true,
      ...publicReport(report),
    }),
  );
} finally {
  await e.close();
  await f.close();
}

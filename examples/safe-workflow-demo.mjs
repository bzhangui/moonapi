import { workflowFixture, workflowSource } from "./workflow-fixture.mjs";
import { runProject } from "../platform/project-config.mjs";
import { publicReport } from "../platform/ci-tools.mjs";
const fixture = await workflowFixture();
try {
  const report = await runProject(
    {
      source: workflowSource(),
      base: fixture.base,
      mode: "owned",
      resource: {
        create: "create",
        read: "read",
        update: "update",
        remove: "delete",
      },
    },
    { allowWrite: true, allowCleanup: true },
  );
  if (!report.passed || !report.cleanup_verified || fixture.remaining !== 0)
    throw new Error("CONTROLLED_DEMO_FAILED");
  console.log(
    JSON.stringify(
      {
        synthetic_demo: true,
        real_user_validation: false,
        ...publicReport(report),
      },
      null,
      2,
    ),
  );
} finally {
  await fixture.close();
}

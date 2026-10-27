import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const root = path.resolve(process.argv[2]);
const { startWorkbench } = await import(
  pathToFileURL(path.join(root, "platform/workbench-server.mjs"))
);
const { workflowFixture, workflowSource } = await import(
  pathToFileURL(path.join(root, "examples/workflow-fixture.mjs"))
);
const f = await workflowFixture(),
  s = await startWorkbench({ port: 0 });
const headers = {
  authorization: "Bearer " + s.token,
  "content-type": "application/json",
};
try {
  for (const rel of [
    "/",
    "/app.js",
    "/app.css",
    "/assets/primer.css",
    "/assets/tokens/primitives.css",
    "/assets/tokens/functional/themes/light.css",
  ])
    assert.equal((await fetch(s.origin + rel)).status, 200, rel);
  const info = await (
    await fetch(s.origin + "/api/inspect", {
      method: "POST",
      headers,
      body: JSON.stringify({ source: workflowSource() }),
    })
  ).json();
  assert.deepEqual(info.readonly_default, ["health"]);
  assert.equal(info.operations[0].route, "/health");
  assert.equal(
    (
      await fetch(s.origin + "/api/run", {
        method: "POST",
        headers,
        body: JSON.stringify({
          source: workflowSource(),
          base: f.base,
          mode: "contract",
        }),
      })
    ).status,
    202,
  );
  let result;
  for (let i = 0; i < 120; i++) {
    result = await (await fetch(s.origin + "/api/status", { headers })).json();
    if (result.state !== "running") break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(result.report.passed, true);
  assert.equal(result.report.execution.unknown_writes, 0);
  console.log(
    JSON.stringify({
      relocated_workbench_verified: true,
      readonly_default: true,
      publicly_uploaded: false,
    }),
  );
} finally {
  await s.close();
  await f.close();
}

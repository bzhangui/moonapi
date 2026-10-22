import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
if (!process.argv[2])
  throw new Error("Pass the built portable package directory");
const bundle = path.resolve(process.argv[2] || "");
const verified = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("./verify-package.mjs", import.meta.url)), bundle],
  { encoding: "utf8", shell: false },
);
if (verified.status !== 0)
  throw new Error(
    "Only a verified portable package can be copied for smoke testing",
  );
const parent = fs.realpathSync(os.tmpdir()),
  owned = fs.mkdtempSync(path.join(parent, "moonapi-package-smoke-"));
try {
  const copy = path.join(owned, "package");
  fs.cpSync(bundle, copy, {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
  const run = (relative, args = []) => {
    const r = spawnSync(
      process.execPath,
      [path.join(copy, relative), ...args],
      {
        cwd: copy,
        encoding: "utf8",
        shell: false,
        timeout: 30000,
        maxBuffer: 1048576,
      },
    );
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  const planned = JSON.parse(
    run("bin/moonapi.mjs", ["plan", "examples/spec.json"]),
  );
  assert.ok(planned.cases.length > 0);
  assert.equal(planned.inputs_hidden, true);
  const modelPlan = JSON.parse(
    run("bin/moonapi-behavior.mjs", [
      "plan",
      "examples/spec.json",
      "--model",
      "examples/behavior.json",
    ]),
  );
  assert.equal(modelPlan.steps.length, 8);
  assert.equal(modelPlan.inputs_hidden, true);
  const crudPlan = JSON.parse(run("bin/moonapi-crud.mjs", ["plan", "examples/spec.json", "--collection", "/items", "--field", "name"]));
  assert.equal(crudPlan.steps.length, 6);
  assert.equal(crudPlan.inputs_hidden, true);
  const crud = JSON.parse(run("examples/crud-demo.mjs"));
  assert.equal(crud.cases.length, 2);
  assert.equal(crud.cases[1].minimized_steps, 3);
  run("examples/demo.mjs");
  const behavior = JSON.parse(run("examples/behavior-demo.mjs"));
  assert.equal(behavior.results.length, 5);
  assert.equal(
    behavior.results.find((r) => r.case === "ignored_update").minimized_steps,
    3,
  );
  assert.equal(
    behavior.results.find((r) => r.case === "double_cancel_inventory_credit")
      .minimized_steps,
    5,
  );
  console.log(
    JSON.stringify({
      portable_functional_smoke: true,
      core_rebuild_required: false,
      cli_plans: 3,
      stateful_cases: 5,
      reports_private: true,
    }),
  );
} finally {
  assert.equal(path.dirname(owned), parent);
  assert.ok(path.basename(owned).startsWith("moonapi-package-smoke-"));
  fs.rmSync(owned, { recursive: true, force: true });
}

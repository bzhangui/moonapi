import { run, moon, versionCheck } from "./build.mjs";
import fs from "node:fs";
console.log(versionCheck());
run(moon, ["update"]);
run(moon, ["fmt", "--check"]);
for (const target of ["js", "wasm", "wasm-gc", "native"]) {
  run(moon, ["check", "--target", target, "--deny-warn"]);
  run(moon, ["build", "--target", target, "--release", "--deny-warn"]);
  run(moon, ["test", "--target", target, "--deny-warn"]);
  run(moon, ["run", "examples/core", "--target", target]);
  run(moon, ["run", "examples/behavior_core", "--target", target]);
  run(moon, ["run", "examples/crud_core", "--target", target]);
  run(moon, ["run", "examples/workflow_core", "--target", target]);
}
run(process.execPath, ["scripts/build.mjs"]);
run(process.execPath, ["scripts/policy-parity.mjs"]);
run(process.execPath, [
  "--test",
  "--test-concurrency=4",
  ...fs
    .readdirSync("tests")
    .filter((name) => name.endsWith(".test.mjs"))
    .sort()
    .map((name) => "tests/" + name),
]);
run(process.execPath, ["examples/demo.mjs"]);
run(process.execPath, ["examples/behavior-demo.mjs"]);
run(process.execPath, ["examples/crud-demo.mjs"]);
run(process.execPath, ["examples/standard-demo.mjs"]);
run(process.execPath, ["examples/standard-advanced-demo.mjs"]);
run(process.execPath, ["examples/modern-demo.mjs"]);
run(process.execPath, ["examples/workflow-demo.mjs"]);
run(process.execPath, ["examples/safe-workflow-demo.mjs"]);
run(process.execPath, ["examples/recovery-demo.mjs"]);
run(process.execPath, ["examples/owned-reduction-demo.mjs"]);
run(process.execPath, ["examples/feedback-demo.mjs"]);
run(process.execPath, ["--expose-gc", "scripts/soak.mjs"]);
run(moon, ["coverage", "clean"]);
run(moon, ["test", "--target", "js", "--enable-coverage", "--deny-warn"]);
run(moon, [
  "coverage",
  "report",
  "-p",
  "bzhangui/moonapi/core",
  "-f",
  "summary",
]);
run(process.execPath, ["scripts/check-package.mjs"]);
run(process.execPath, ["scripts/audit-public.mjs"]);
console.log(
  // Publication is a separate authorized action; this only audits the archive.
  "All maintenance checks passed. Controlled API fixtures do not replace real-user pilots.",
);

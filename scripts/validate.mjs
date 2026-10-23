import { run, moon, moonEnv } from "./build.mjs";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
const version = spawnSync(moon, ["version", "--all"], {
  encoding: "utf8",
  env: moonEnv,
});
if (version.status !== 0) throw new Error("Toolchain unavailable");
console.log(version.stdout.trim());
run(moon, ["update"]);
run(moon, ["fmt", "--check"]);
for (const target of ["js", "wasm", "wasm-gc", "native"]) {
  run(moon, ["check", "--target", target, "--deny-warn"]);
  run(moon, ["build", "--target", target, "--release", "--deny-warn"]);
  run(moon, ["test", "--target", target, "--deny-warn"]);
  run(moon, ["run", "examples/core", "--target", target]);
  run(moon, ["run", "examples/behavior_core", "--target", target]);
  run(moon, ["run", "examples/crud_core", "--target", target]);
}
run(process.execPath, ["scripts/build.mjs"]);
run(process.execPath, [
  "--test",
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
console.log(
  // Publication is a separate authorized action; this only audits the archive.
  "All maintenance checks passed. Controlled API fixtures do not replace real-user pilots.",
);

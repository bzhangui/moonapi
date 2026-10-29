// Build a relocatable, offline-after-install standards runtime. No user files,
// SDK, databases, credentials, reports or backend binaries enter the allowlist.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolveNpmCLI } from "./npm-cli.mjs";
import { releaseMetadata } from "./release-metadata.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const version = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
).version;
const destination = path.join(
  root,
  ".local/releases",
  `moonapi-standard-${version}-${process.platform}-${randomUUID().slice(0, 8)}`,
);
const allowed = [
  "LICENSE",
  "NOTICE",
  "SECURITY.md",
  "licenses/MoonBit-Apache-2.0.txt",
  "package.json",
  "package-lock.json",
  "docs/STANDARD_ENGINE.md",
  "docs/WORKFLOW.md",
  "docs/THIRD_PARTY.md",
  "docs/COMPARISON.md",
  "docs/UPGRADE_0_5.md",
  "docs/UPGRADE_0_6.md",
  "docs/UPGRADE_0_7.md",
  "docs/UPGRADE_0_8.md",
  "docs/UPGRADE_0_9.md",
  "docs/VERSION_POLICY.md",
  "docs/QUALITY_REPORT.md",
  "docs/PUBLICATION.md",
  "docs/OPENAPI_3_0_MATRIX.md",
  "docs/OPENAPI_3_1_3_2_MATRIX.md",
  "_build/js/release/build/cmd/bridge/bridge.js",
  "platform/input.mjs",
  "platform/runner.mjs",
  "platform/behavior.mjs",
  "platform/owned-crud.mjs",
  "platform/standard.mjs",
  "platform/standard-worker.mjs",
  "platform/standard-schema.mjs",
  "platform/standard-document.mjs",
  "platform/standard-codec.mjs",
  "platform/standard-media.mjs",
  "platform/standard-xml.mjs",
  "platform/standard-value.mjs",
  "platform/standard-expression.mjs",
  "platform/standard-http.mjs",
  "platform/standard-callback.mjs",
  "platform/standard-capabilities.mjs",
  "platform/standard-content.mjs",
  "platform/standard-method.mjs",
  "platform/standard-transfer.mjs",
  "platform/workflow.mjs",
  "platform/workflow-templates.mjs",
  "platform/ci-tools.mjs",
  "platform/private-store.mjs",
  "platform/confirmed-witness.mjs",
  "platform/execution-ledger.mjs",
  "platform/execution-intent.mjs",
  "platform/diagnostics.mjs",
  "platform/signed-artifact.mjs",
  "platform/adapter-conformance.mjs",
  "platform/workflow-migration.mjs",
  "platform/modern-schema.mjs",
  "platform/modern-schema-worker.mjs",
  "platform/modern-exact.mjs",
  "platform/modern-resources.mjs",
  "platform/modern-document.mjs",
  "platform/modern-generation.mjs",
  "platform/modern-media.mjs",
  "platform/modern-xml.mjs",
  "platform/modern-linkset.mjs",
  "platform/modern-stream-state.mjs",
  "platform/sequence-media.mjs",
  "platform/isolation.mjs",
  "platform/adapters.mjs",
  "platform/graph.mjs",
  "platform/concurrency.mjs",
  "platform/input-shrink.mjs",
  "platform/input-protection.mjs",
  "platform/response-corpus.mjs",
  "platform/definition.mjs",
  "platform/dialects.mjs",
  "platform/dialect-worker.mjs",
  "platform/project-config.mjs",
  "platform/workbench-server.mjs",
  "bin/moonapi-standard.mjs",
  "bin/moonapi-ci.mjs",
  "bin/moonapi-project.mjs",
  "bin/moonapi-workbench.mjs",
  "bin/moonapi-dialect.mjs",
  "bin/moonapi.mjs",
  "bin/moonapi-behavior.mjs",
  "bin/moonapi-crud.mjs",
  "examples/standard-demo.mjs",
  "examples/modern-demo.mjs",
  "examples/standard-spec.json",
  "examples/standard-fixture.mjs",
  "examples/standard-advanced-demo.mjs",
  "examples/workflow-demo.mjs",
  "examples/workflow-fixture.mjs",
  "examples/safe-workflow-demo.mjs",
  "examples/recovery-demo.mjs",
  "examples/owned-reduction-demo.mjs",
  "examples/feedback-demo.mjs",
  "examples/feedback-fixture.mjs",
  "examples/fenced-sqlite.mjs",
  "workbench/index.html",
  "workbench/app.js",
  "workbench/app.css",
];
fs.mkdirSync(destination, { recursive: true });
for (const rel of allowed) {
  const target = path.join(destination, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(root, rel), target, fs.constants.COPYFILE_EXCL);
}
fs.copyFileSync(
  path.join(root, "docs/STANDARD_PORTABLE.md"),
  path.join(destination, "README.md"),
  fs.constants.COPYFILE_EXCL,
);
// Runtime consumers have no SDK/build/test source tree. Do not advertise npm
// scripts whose targets are intentionally absent from the delivered bundle.
const runtimePackage = JSON.parse(
  fs.readFileSync(path.join(destination, "package.json"), "utf8"),
);
runtimePackage.scripts = {
  "demo:standard": "node examples/standard-demo.mjs",
  "demo:modern": "node examples/modern-demo.mjs",
  "demo:advanced": "node examples/standard-advanced-demo.mjs",
  "demo:workflow": "node examples/workflow-demo.mjs",
  "demo:safe": "node examples/safe-workflow-demo.mjs",
  "demo:recovery": "node examples/recovery-demo.mjs",
  "demo:owned-reduction": "node examples/owned-reduction-demo.mjs",
  "demo:feedback": "node examples/feedback-demo.mjs",
  workbench: "node bin/moonapi-workbench.mjs",
};
fs.writeFileSync(
  path.join(destination, "package.json"),
  JSON.stringify(runtimePackage, null, 2),
);
const npmCLI = resolveNpmCLI();
const installed = spawnSync(
  process.execPath,
  [
    npmCLI,
    "ci",
    "--omit=dev",
    "--ignore-scripts",
    "--no-fund",
    "--no-audit",
    "--bin-links=false",
  ],
  { cwd: destination, stdio: "inherit", timeout: 180000, windowsHide: true },
);
if (installed.status !== 0)
  throw new Error("Standard runtime locked install failed");
const bins = path.join(destination, "node_modules/.bin");
// Generated npm launcher links are unnecessary for direct node entry points.
if (fs.existsSync(bins)) throw new Error("Unexpected npm launchers");
const files = {};
function inventory(dir, prefix = "") {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix + item.name,
      absolute = path.join(dir, item.name);
    if (item.isSymbolicLink()) throw new Error("Runtime link not allowed");
    if (item.isDirectory()) inventory(absolute, rel + "/");
    else if (item.isFile())
      files[rel] = createHash("sha256")
        .update(fs.readFileSync(absolute))
        .digest("hex");
    else throw new Error("Runtime special file");
  }
}
releaseMetadata(destination);
inventory(destination);
fs.writeFileSync(
  path.join(destination, "manifest.json"),
  JSON.stringify(
    { format: 2, name: "MoonAPI", version, runtime: "Node >=22.19.0", files },
    null,
    2,
  ),
  { flag: "wx" },
);
for (const [script, args] of [
  [path.join(root, "scripts/verify-package.mjs"), [destination]],
  [
    path.join(destination, "bin/moonapi-standard.mjs"),
    ["check", "examples/standard-spec.json"],
  ],
  [path.join(destination, "examples/standard-demo.mjs"), []],
  [path.join(destination, "examples/modern-demo.mjs"), []],
  [path.join(destination, "examples/standard-advanced-demo.mjs"), []],
  [path.join(destination, "examples/workflow-demo.mjs"), []],
  [path.join(destination, "examples/safe-workflow-demo.mjs"), []],
  [path.join(destination, "examples/recovery-demo.mjs"), []],
  [path.join(destination, "examples/owned-reduction-demo.mjs"), []],
  [path.join(destination, "examples/feedback-demo.mjs"), []],
  [path.join(root, "scripts/smoke-workbench.mjs"), [destination]],
  [path.join(root, "scripts/smoke-modern.mjs"), [destination]],
  [
    path.join(destination, "bin/moonapi-dialect.mjs"),
    ["examples/standard-spec.json"],
  ],
]) {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: destination,
    stdio: "inherit",
    timeout: 120000,
    windowsHide: true,
  });
  if (r.status !== 0)
    throw new Error("Relocated standards runtime smoke failed");
}
console.log(
  JSON.stringify({
    bundle: destination,
    files: Object.keys(files).length,
    independent_locked_install: true,
    SDK_required: false,
    node_bundled: false,
    registry_core_is_not_node_runtime: true,
    publicly_uploaded: false,
  }),
);

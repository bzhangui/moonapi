import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  workflowFixture,
  workflowSource,
} from "../examples/workflow-fixture.mjs";
import { resourceWorkflow } from "../platform/workflow-templates.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
async function cli(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ["bin/moonapi-ci.mjs", ...args], {
      cwd: root,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    p.stdout.on("data", (b) => (stdout += b));
    p.stderr.on("data", (b) => (stderr += b));
    const timer = setTimeout(() => {
      p.kill();
      reject(new Error("CI_CLI_TEST_TIMEOUT"));
    }, 20000);
    p.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}
test("CI workflow CLI runs real HTTP, emits three redacted report formats and fails denied writes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "moonapi-ci-cli-")),
    f = await workflowFixture();
  try {
    const spec = path.join(dir, "spec.json"),
      model = path.join(dir, "model.json"),
      prefix = path.join(dir, "report");
    fs.writeFileSync(spec, workflowSource());
    fs.writeFileSync(
      model,
      JSON.stringify(
        resourceWorkflow({
          create: "create",
          read: "read",
          update: "update",
          remove: "delete",
          initial: "PRIVATE_MARKER",
          changed: "PRIVATE_CHANGED",
        }),
      ),
    );
    const denied = await cli([
      "workflow",
      spec,
      "--base",
      f.base,
      "--model",
      model,
    ]);
    assert.equal(denied.code, 2);
    assert.equal(f.requests, 0);
    const result = await cli([
      "workflow",
      spec,
      "--base",
      f.base,
      "--model",
      model,
      "--allow-write",
      "--report-prefix",
      prefix,
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).passed, true);
    for (const ext of ["json", "xml", "html"]) {
      const text = fs.readFileSync(prefix + "." + ext, "utf8");
      assert.ok(!text.includes("PRIVATE_"));
      assert.ok(!text.includes(f.base));
      assert.ok(!text.includes("operation_id"));
    }
    assert.equal(f.remaining, 0);
  } finally {
    await f.close();
    fs.rmSync(dir, { recursive: true });
  }
});
test("CI diff detects external-document change; YAML uncertainty selects full suite without a false green", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "moonapi-ci-diff-"));
  try {
    const spec = path.join(dir, "spec.json"),
      a = path.join(dir, "a.json"),
      b = path.join(dir, "b.json");
    fs.writeFileSync(spec, workflowSource());
    fs.writeFileSync(
      a,
      JSON.stringify({ "https://example.invalid/schema.json": "old" }),
    );
    fs.writeFileSync(
      b,
      JSON.stringify({ "https://example.invalid/schema.json": "new" }),
    );
    const r = await cli([
      "diff",
      spec,
      "--before",
      spec,
      "--before-references",
      a,
      "--references",
      b,
    ]);
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.stdout).full_suite_required, true);
    const yaml = path.join(dir, "schema.yaml");
    fs.writeFileSync(yaml, "openapi: 3.0.4\n");
    const u = await cli(["diff", yaml, "--before", yaml]);
    assert.equal(JSON.parse(u.stdout).full_suite_required, true);
    const bad = await cli(["run", spec, "--SECRET_PRIVATE_VALUE"]);
    assert.equal(bad.code, 2);
    assert.ok(!bad.stderr.includes("SECRET_PRIVATE_VALUE"));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

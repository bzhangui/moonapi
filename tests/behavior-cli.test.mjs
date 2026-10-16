import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fixture } from "../examples/fixture.mjs";
import { behaviorSource } from "../examples/behavior-demo.mjs";
const cli = fileURLToPath(
  new URL("../bin/moonapi-behavior.mjs", import.meta.url),
);
const modelFile = fileURLToPath(
  new URL("../examples/behavior.json", import.meta.url),
);
function child(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [cli, ...args], {
      windowsHide: true,
      shell: false,
    });
    let out = "",
      err = "";
    const timer = setTimeout(() => {
      p.kill();
      reject(new Error("CLI test timeout"));
    }, 15000);
    p.stdout.on("data", (b) => (out += b));
    p.stderr.on("data", (b) => (err += b));
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
  });
}
async function owned(work) {
  const parent = fs.realpathSync(os.tmpdir()),
    dir = fs.mkdtempSync(path.join(parent, "moonapi-behavior-cli-"));
  try {
    const file = path.join(dir, "spec.json");
    fs.writeFileSync(file, behaviorSource());
    await work(file);
  } finally {
    assert.equal(path.dirname(dir), parent);
    assert.ok(path.basename(dir).startsWith("moonapi-behavior-cli-"));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
test("behavior CLI plans without write permission and rejects duplicate options", () =>
  owned(async (file) => {
    const planned = await child(["plan", file, "--model", modelFile]);
    assert.equal(planned.code, 0, planned.err);
    assert.equal(JSON.parse(planned.out).steps.length, 8);
    assert.equal(
      (await child(["plan", file, "--model", modelFile, "--model", modelFile]))
        .code,
      2,
    );
  }));
test("behavior CLI actually resets executes and shrinks without exposing payloads", () =>
  owned(async (file) => {
    const server = await fixture({ enableReset: true, staleUpdate: true });
    try {
      const result = await child([
        "run",
        file,
        "--model",
        modelFile,
        "--base",
        server.base,
        "--reset-operation",
        "reset",
        "--allow-reset",
        "--allow-write",
        "--shrink-write",
      ]);
      assert.equal(result.code, 1, result.err);
      const report = JSON.parse(result.out);
      assert.equal(report.confirmed, true);
      assert.equal(report.minimized_steps, 3);
      assert.ok(server.resets > 1);
      assert.ok(!result.out.includes("second"));
    } finally {
      await server.close();
    }
  }));

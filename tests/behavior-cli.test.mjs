import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
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
function child(args, entry = cli) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [entry, ...args], {
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

test("both CLIs hide malformed JSON contents and sensitive file paths", () =>
  owned(async (file) => {
    const secret = "controlled-only-private-syntax-value";
    const malformed = path.join(path.dirname(file), secret + ".json");
    fs.writeFileSync(malformed, secret);
    const legacy = fileURLToPath(
      new URL("../bin/moonapi.mjs", import.meta.url),
    );
    for (const [entry, args] of [
      [cli, ["plan", file, "--model", malformed]],
      [
        legacy,
        ["run", file, "--base", "http://127.0.0.1:1", "--scenario", malformed],
      ],
      [legacy, ["plan", malformed + ".missing"]],
    ]) {
      const result = await child(args, entry);
      assert.equal(result.code, 2);
      assert.ok(
        !(result.out + result.err).includes(secret),
        "input data leaked in CLI error",
      );
      assert.doesNotThrow(() => JSON.parse(result.err));
    }
  }));

test("reset CLI rejects declared errors and asynchronous acceptance before running a trace", () =>
  owned(async (file) => {
    const modelFile = path.join(path.dirname(file), "read-model.json");
    fs.writeFileSync(
      modelFile,
      JSON.stringify({
        format: 1,
        name: "reset_guard",
        initial: {},
        steps: [{ id: "read", operationId: "health" }],
      }),
    );
    for (const status of [400, 404, 202]) {
      const paths = [];
      const server = http.createServer((req, res) => {
        paths.push(req.url);
        res.statusCode = req.url === "/__test/reset" ? status : 200;
        res.end();
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        fs.writeFileSync(
          file,
          JSON.stringify({
            openapi: "3.0.3",
            paths: {
              "/__test/reset": {
                post: { operationId: "reset", responses: { [status]: {} } },
              },
              "/health": {
                get: { operationId: "health", responses: { 200: {} } },
              },
            },
          }),
        );
        const result = await child([
          "run",
          file,
          "--model",
          modelFile,
          "--base",
          "http://127.0.0.1:" + server.address().port,
          "--reset-operation",
          "reset",
          "--allow-reset",
          "--allow-write",
        ]);
        assert.equal(result.code, 1, result.err);
        const report = JSON.parse(result.out);
        assert.equal(report.complete, false);
        assert.equal(report.executed, 0);
        assert.deepEqual(paths, ["/__test/reset"]);
      } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
    }
  }));

test("both CLIs reject invalid UTF-8 instead of silently replacing source or model bytes", () =>
  owned(async (file) => {
    const bad = path.join(path.dirname(file), "invalid-utf8.json");
    const original = fs.readFileSync(modelFile, "utf8");
    const text = original.replace("second", "PRIVATE_MARKER");
    const [before, after] = text.split("PRIVATE_MARKER");
    assert.equal(typeof after, "string");
    fs.writeFileSync(
      bad,
      Buffer.concat([
        Buffer.from(before),
        Buffer.from([0xc3, 0x28]),
        Buffer.from(after),
      ]),
    );
    const legacy = fileURLToPath(
      new URL("../bin/moonapi.mjs", import.meta.url),
    );
    const invalidModel = await child(["plan", file, "--model", bad]);
    assert.equal(invalidModel.code, 2);
    assert.match(invalidModel.err, /UTF-8/);
    fs.writeFileSync(
      bad,
      Buffer.concat([
        Buffer.from('{"openapi":"3.0.3","info":{"title":"'),
        Buffer.from([0xc3, 0x28]),
        Buffer.from(
          '"},"paths":{"/health":{"get":{"operationId":"health","responses":{"200":{}}}}}}',
        ),
      ]),
    );
    for (const [entry, args] of [
      [cli, ["plan", bad, "--model", modelFile]],
      [legacy, ["plan", bad]],
    ]) {
      const result = await child(args, entry);
      assert.equal(result.code, 2);
      assert.match(result.err, /UTF-8/);
    }
  }));

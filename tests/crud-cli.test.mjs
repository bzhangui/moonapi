import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { fixture } from "../examples/fixture.mjs";
const entry = fileURLToPath(
  new URL("../bin/moonapi-crud.mjs", import.meta.url),
);
const spec = fileURLToPath(new URL("../examples/spec.json", import.meta.url));
const select = [spec, "--collection", "/items", "--field", "name"];
const child = (args) =>
  new Promise((resolve) => {
    execFile(
      process.execPath,
      [entry, ...args],
      { windowsHide: true, shell: false, timeout: 15000, maxBuffer: 1048576 },
      (error, out, err) => resolve({ code: error ? error.code : 0, out, err }),
    );
  });
test("CRUD CLI plans redacted steps and refuses duplicate or secret-looking unknown options", async () => {
  const p = await child(["plan", ...select]);
  assert.equal(p.code, 0, p.err);
  assert.equal(JSON.parse(p.out).steps.length, 6);
  assert.equal(JSON.parse(p.out).inputs_hidden, true);
  assert.ok(!p.out.includes("moonapi_"));
  assert.equal((await child(["plan", ...select, "--field", "name"])).code, 2);
  const invalid = await child([
    "plan",
    ...select,
    "--private-token-DO-NOT-ECHO",
  ]);
  assert.equal(invalid.code, 2);
  assert.ok(!invalid.err.includes("DO-NOT-ECHO"));
  assert.ok(!invalid.err.includes(spec));
});
test("CRUD CLI write and cleanup permissions are required before HTTP", async () => {
  const s = await fixture();
  try {
    const r = await child([
      "run",
      ...select,
      "--base",
      s.base,
      "--allow-write",
    ]);
    assert.equal(r.code, 2);
    assert.equal(s.requests, 0);
  } finally {
    await s.close();
  }
});
test("CRUD CLI actually runs healthy and lost-update paths with truthful exit codes", async () => {
  for (const staleUpdate of [false, true]) {
    const s = await fixture({ staleUpdate });
    try {
      const r = await child([
        "run",
        ...select,
        "--base",
        s.base,
        "--allow-write",
        "--allow-cleanup",
        "--shrink-write",
      ]);
      assert.equal(r.code, staleUpdate ? 1 : 0, r.err);
      const result = JSON.parse(r.out);
      assert.equal(result.cleanup_verified, true);
      assert.equal(result.confirmed, staleUpdate);
      assert.equal(result.minimized_steps, staleUpdate ? 3 : 6);
      const report = JSON.parse(fs.readFileSync(result.report, "utf8"));
      assert.equal(report.complete, !staleUpdate);
      assert.ok(!JSON.stringify(report).includes("moonapi_"));
      assert.equal(s.items.size, 0);
    } finally {
      await s.close();
    }
  }
});

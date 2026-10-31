import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  processFailureReceipt,
  saveProcessFailure,
} from "../platform/process-receipt.mjs";
test("Windows native failure receipt keeps exit code without pretending root cause or retaining payloads", () => {
  const r = processFailureReceipt(
    {
      status: 0xc0000409,
      stdout: "private-response",
      stderr: "private-token",
      error: new Error("private-path"),
    },
    { tool: "private-executable", elapsedMs: 4 },
  );
  assert.equal(r.status_hex, "0xc0000409");
  assert.equal(r.root_cause_known, false);
  assert.equal(r.automatic_retry, false);
  assert.equal(JSON.stringify(r).includes("private"), false);
  assert.throws(() => processFailureReceipt({ status: 0 }));
});
test("diagnostic storage stops at bounded files and never evicts prior evidence", () => {
  const directory = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "moonapi-process-test-"),
  );
  try {
    for (let i = 0; i < 32; i++) saveProcessFailure({ status: 1 }, directory);
    assert.equal(fs.readdirSync(directory).length, 32);
    assert.throws(() => saveProcessFailure({ status: 1 }, directory), /BUDGET/);
    assert.equal(fs.readdirSync(directory).length, 32);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

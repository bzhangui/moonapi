import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readTextInput, readJsonInput } from "../platform/input.mjs";

function owned(work) {
  const parent = fs.realpathSync(os.tmpdir());
  const dir = fs.mkdtempSync(path.join(parent, "moonapi-input-test-"));
  try {
    work(path.join(dir, "controlled-only-private-filename.json"), dir);
  } finally {
    assert.equal(path.dirname(dir), parent);
    assert.ok(path.basename(dir).startsWith("moonapi-input-test-"));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("input reader preserves Unicode and accepts UTF-8 BOM without lossy decoding", () =>
  owned((file) => {
    const text = JSON.stringify({ name: "中文😀" });
    fs.writeFileSync(file, text);
    assert.equal(readTextInput(file, Buffer.byteLength(text)), text);
    fs.writeFileSync(
      file,
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]),
    );
    assert.deepEqual(readJsonInput(file, 128), { name: "中文😀" });
    fs.writeFileSync(file, Buffer.from([0xc3, 0x28]));
    assert.throws(() => readTextInput(file, 128), /UTF-8/);
  }));

test("input reader enforces byte budgets and sanitizes file and parser errors", () =>
  owned((file, dir) => {
    fs.writeFileSync(file, "中文");
    assert.equal(readTextInput(file, 6), "中文");
    assert.throws(() => readTextInput(file, 5), /oversized/);
    for (const target of [file + ".missing", dir]) {
      assert.throws(
        () => readTextInput(target, 128),
        (error) =>
          error.message === "Missing, oversized or invalid UTF-8 input file",
      );
    }
    for (const limit of [0, -1, 1.5, Infinity, 1048577])
      assert.throws(() => readTextInput(file, limit), /budget/);
    fs.writeFileSync(file, "controlled-only-private-parser-value");
    assert.throws(
      () => readJsonInput(file, 128),
      (error) => error.message === "Invalid JSON input (contents hidden)",
    );
  }));

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  contractDiff,
  documentDigest,
  historyFor,
  historyPriority,
  renderReports,
  publicReport,
  saveReplay,
  loadReplay,
} from "../platform/ci-tools.mjs";
import { number, stringifyExact } from "../platform/standard-value.mjs";
test("conservative contract diff expands component changes and marks removed operations", () => {
  const a = {
    openapi: "3.0.4",
    paths: {
      "/a": { get: { operationId: "a" } },
      "/b": { post: { operationId: "b" } },
    },
  };
  assert.deepEqual(contractDiff(a, a).affected, []);
  const b = structuredClone(a);
  b.paths["/a"].get.summary = "changed";
  assert.deepEqual(contractDiff(a, b).affected, ["a"]);
  b.components = { schemas: { X: { type: "string" } } };
  assert.deepEqual(contractDiff(a, b).affected, ["a", "b"]);
  delete b.paths["/b"];
  assert.deepEqual(contractDiff(a, b).removed, ["b"]);
});
test("historical failures prioritize only the same document and granted references", () => {
  const hash = documentDigest("x", { "https://example.invalid/z": "a" }),
    history = historyFor(
      {
        records: [
          { operation_id: "x", passed: false },
          { operation_id: "y", passed: true },
        ],
      },
      hash,
    );
  assert.deepEqual(historyPriority(history, hash, ["x", "y"]), ["x"]);
  assert.deepEqual(
    historyPriority(
      history,
      documentDigest("x", { "https://example.invalid/z": "b" }),
      ["x", "y"],
    ),
    [],
  );
});
test("all public formats whitelist metadata, escape malicious fields, and fail empty/incomplete runs", () => {
  const secret = "TOKEN<svg onload=evil>",
    report = {
      passed: false,
      complete: false,
      blockers: [{ code: secret }],
      records: [
        {
          passed: false,
          status: 500,
          category: "defect",
          code: "server_error",
          operation_id: secret,
          body: { token: secret },
        },
      ],
    };
  const formats = renderReports(report);
  for (const content of Object.values(formats))
    assert.ok(!content.includes(secret));
  assert.match(formats.junit, /failures="1"/);
  assert.match(
    renderReports({ passed: false, records: [] }).junit,
    /errors="1"/,
  );
  assert.equal(
    publicReport({ records: [{ category: secret, code: secret }] }).records[0]
      .category,
    "blocked",
  );
  assert.match(formats.html, /default-src 'none'/);
});
test("explicit private replay export preserves exact numbers, forbids overwrite, and pins the source", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "moonapi-replay-")),
    file = path.join(dir, "case.json");
  try {
    const data = {
      source: "spec",
      model: { id: number("9223372036854775807") },
      credentialEnvironment: "MOONAPI_TEST_CREDENTIALS",
    };
    assert.throws(() => saveReplay(file, data), /NOT_AUTHORIZED/);
    saveReplay(file, data, true);
    assert.match(
      stringifyExact(loadReplay(file, { source: "spec" }).model),
      /9223372036854775807/,
    );
    assert.ok(!fs.readFileSync(file, "utf8").includes("Bearer"));
    assert.throws(() => saveReplay(file, data, true));
    assert.throws(() => loadReplay(file, { source: "different" }), /MISMATCH/);
  } finally {
    fs.unlinkSync(file);
    fs.rmdirSync(dir);
  }
});

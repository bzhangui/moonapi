import test from "node:test";
import assert from "node:assert/strict";
import { inspectDialect } from "../platform/dialects.mjs";
import {
  parseDefinition,
  canonicalDefinition,
} from "../platform/definition.mjs";
import { contractDiff } from "../platform/ci-tools.mjs";
import { StandardEngine } from "../platform/standard.mjs";
import { capabilitiesFor } from "../platform/standard-capabilities.mjs";
test("dialect inspection uses native document and Schema validation without conflating support with certification", async () => {
  for (const version of ["3.0.4", "3.1.2", "3.2.1"]) {
    const d = {
      openapi: version,
      info: { title: "dialect check", version: "1" },
      paths: { "/ok": { get: { responses: { 200: { description: "ok" } } } } },
    };
    const r = await inspectDialect(JSON.stringify(d));
    assert.equal(r.structurally_valid, true, JSON.stringify(r));
    assert.equal(r.execution_supported, true);
    assert.equal(
      r.full_openapi_support,
      capabilitiesFor(version).full_openapi_support,
    );
    assert.equal(r.full_dialect_conformance_certified, false);
    assert.equal(r.modern_execution_validated, !version.startsWith("3.0."));
    const engine = await StandardEngine.open(JSON.stringify(d));
    try {
      assert.equal((await engine.plan()).cases.length > 0, true);
    } finally {
      await engine.close();
    }
    d.paths["/ok"].get.responses = 42;
    assert.equal(
      (await inspectDialect(JSON.stringify(d))).structurally_valid,
      false,
    );
  }
});
test("dialect resolver has no ambient file/network grants and preserves ref siblings", async () => {
  const d = {
    openapi: "3.1.2",
    info: { title: "safe", version: "1" },
    paths: {
      "/ok": {
        get: { responses: { 200: { $ref: "https://private.invalid/secret" } } },
      },
    },
  };
  const r = await inspectDialect(JSON.stringify(d));
  assert.equal(r.structurally_valid, false);
  assert.equal(
    (
      await inspectDialect(JSON.stringify(d), {
        documents: {
          "https://private.invalid/secret": "description: explicit response",
        },
      })
    ).structurally_valid,
    true,
  );
  const parsed = parseDefinition(
    'openapi: 3.1.2\nx: {$ref: "#/other", description: keep}\nother: 9223372036854775807',
  );
  assert.equal(parsed.x.description, "keep");
  assert.match(canonicalDefinition(parsed), /9223372036854775807/);
  assert.throws(() => parseDefinition("a: 1\na: 2"), /DEFINITION/);
});
test("lossless YAML contract diff follows transitive local refs and ignores key ordering", () => {
  const d = {
    openapi: "3.0.4",
    info: { title: "diff", version: "1" },
    components: {
      schemas: { A: { $ref: "#/components/schemas/B" }, B: { type: "string" } },
    },
    paths: {
      "/a": {
        get: {
          operationId: "a",
          responses: { 200: { schema: { $ref: "#/components/schemas/A" } } },
        },
      },
      "/b": { get: { operationId: "b" } },
    },
  };
  const next = structuredClone(d);
  next.components.schemas.B.maxLength = 3;
  assert.deepEqual(contractDiff(d, next).affected, ["a"]);
  assert.equal(contractDiff(d, next).full_suite_required, false);
  assert.deepEqual(
    contractDiff("openapi: 3.0.4\npaths: {}", "paths: {}\nopenapi: 3.0.4")
      .affected,
    [],
  );
  assert.deepEqual(
    contractDiff(d, Object.fromEntries(Object.entries(d).reverse())).affected,
    [],
  );
  const auth = structuredClone(d);
  auth.components.securitySchemes = {
    token: { type: "http", scheme: "bearer" },
  };
  const changed = structuredClone(auth);
  changed.components.securitySchemes.token.scheme = "basic";
  assert.equal(contractDiff(auth, changed).full_suite_required, true);
  const indirect = structuredClone(d);
  indirect.paths["/indirect"] = { $ref: "#/x-item" };
  indirect["x-item"] = { get: { operationId: "indirect" } };
  assert.equal(contractDiff(indirect, indirect).full_suite_required, true);
});

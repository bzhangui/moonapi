import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Engine, loadCore } from "../platform/runner.mjs";
import { pocketbaseSpec } from "../examples/pocketbase/spec.mjs";
await loadCore();
test("common parameter requestBody response and schema components compose in CRUD", () => {
  const e = new Engine(pocketbaseSpec("moonapi_notes", "title"));
  const plan = e.command("crud-plan", {
    collection: "/api/collections/moonapi_notes/records",
    field: "title",
    marker: "moonapi_111111111111111111111111",
    changed: "moonapi_222222222222222222222222",
  });
  assert.equal(plan.trace.steps.length, 6);
  assert.equal(plan.create_status, 200);
  assert.equal(plan.id_schema.type, "string");
});
test("references do not hide unsupported response links headers or parameter serialization", () => {
  for (const change of [
    (j) =>
      (j.components.responses.Record.links = { next: { operationId: "read" } }),
    (j) =>
      (j.components.responses.Record.headers = {
        proof: { schema: { type: "string" } },
      }),
    (j) => (j.components.parameters.ID.style = "matrix"),
    (j) =>
      (j.components.requestBodies.Write.content[
        "application/json"
      ].schema.pattern = "x"),
    (j) =>
      (j.components.parameters.ID = { $ref: "#/components/parameters/ID" }),
    (j) =>
      (j.paths[
        "/api/collections/moonapi_notes/records"
      ].post.requestBody.required = true),
  ]) {
    const j = JSON.parse(pocketbaseSpec("moonapi_notes", "title"));
    change(j);
    assert.throws(() => new Engine(JSON.stringify(j)).plan());
  }
});
test("escaped schema names follow RFC6901 and reject ambiguous reference siblings", () => {
  const j = JSON.parse(
    fs.readFileSync(new URL("../examples/spec.json", import.meta.url), "utf8"),
  );
  j.components.schemas["a/b~"] = j.components.schemas.Item;
  j.components.schemas.Item = { $ref: "#/components/schemas/a~1b~0" };
  assert.ok(new Engine(JSON.stringify(j)).plan().length > 0);
  j.components.schemas.Item.description = "ignored-intent";
  assert.throws(() => new Engine(JSON.stringify(j)).plan());
});
test("missing operationId has a stable method/path fallback, explicit malformed IDs still fail", () => {
  const j = JSON.parse(pocketbaseSpec("moonapi_notes", "title"));
  for (const item of Object.values(j.paths))
    for (const [method, op] of Object.entries(item))
      if (method !== "parameters") delete op.operationId;
  const e = new Engine(JSON.stringify(j));
  assert.ok(
    e
      .plan()
      .some(
        (c) => c.operation_id === "POST /api/collections/moonapi_notes/records",
      ),
  );
  const operations = e.command("plan", { limit: 1 }).operations;
  assert.equal(operations.length, 4);
  j.paths["/api/collections/moonapi_notes/records"].post.operationId = null;
  assert.throws(() => new Engine(JSON.stringify(j)).plan());
});
test("shared readOnly/writeOnly schemas generate directional bodies and keep response requiredness", () => {
  const schema = {
    type: "object",
    required: ["id", "secret", "name"],
    additionalProperties: false,
    properties: {
      id: { type: "integer", readOnly: true },
      secret: { type: "string", writeOnly: true },
      name: { type: "string" },
    },
  };
  const j = {
    openapi: "3.0.3",
    paths: {
      "/shared": {
        post: {
          operationId: "shared",
          requestBody: { content: { "application/json": { schema } } },
          responses: { 200: { content: { "application/json": { schema } } } },
        },
      },
    },
  };
  const e = new Engine(JSON.stringify(j));
  const c = e.plan()[0];
  assert.equal(Object.hasOwn(c.body, "id"), false);
  assert.equal(Object.hasOwn(c.body, "secret"), true);
  const valid = (body) =>
    e.command("validate", { case: c, status: 200, body, json_valid: true })
      .finding.passed;
  assert.equal(valid({ id: 1, name: "yes" }), true);
  assert.equal(valid({ name: "yes" }), false);
  assert.equal(valid({ id: 1, secret: "leak", name: "yes" }), false);
  schema.properties.id.writeOnly = true;
  assert.throws(() => new Engine(JSON.stringify(j)).plan());
});

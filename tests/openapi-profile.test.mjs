import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Engine, loadCore } from "../platform/runner.mjs";
await loadCore();
const spec = () =>
  JSON.parse(
    fs.readFileSync(new URL("../examples/spec.json", import.meta.url), "utf8"),
  );
test("experimental profile never silently ignores active unsupported security callbacks or response constraints", () => {
  for (const change of [
    (j) => (j.security = [{ api_key: [] }]),
    (j) => (j.paths["/health"].get.security = [{ oauth: ["write"] }]),
    (j) => (j.paths["/health"].get.callbacks = {}),
    (j) =>
      (j.paths["/health"].get.responses[200].headers = {
        "x-proof": { schema: { type: "string" } },
      }),
    (j) =>
      (j.paths["/health"].get.responses[200].links = {
        next: { operationId: "echo" },
      }),
    (j) => (j.openapi = "3.0.unspecified"),
    (j) => (j.paths["/items/{id}"].parameters[0].style = "form"),
    (j) => (j.paths["/items/{id}"].parameters[0].allowReserved = true),
  ]) {
    const j = spec();
    change(j);
    assert.throws(() => new Engine(JSON.stringify(j)).plan());
  }
});
test("empty security requirements remain a supported no-auth declaration", () => {
  const j = spec();
  j.security = [];
  j.paths["/health"].get.security = [];
  assert.ok(new Engine(JSON.stringify(j)).plan().length > 0);
});

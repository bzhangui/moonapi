import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseExact } from "../platform/standard-value.mjs";
import { validSchema } from "../platform/standard-schema.mjs";
// OAS 3.0 defines a restricted Draft-04 vocabulary. Do not accept the larger
// JSON Schema vocabulary as OAS, or silently remove its constraints to pass.
const unsupported = new Set([
  "$id",
  "id",
  "$schema",
  "definitions",
  "patternProperties",
  "additionalItems",
  "dependencies",
  "const",
  "contains",
  "propertyNames",
]);
function applicable(s) {
  if (!s || typeof s !== "object" || Array.isArray(s)) return false;
  if (
    Object.keys(s).some((k) => unsupported.has(k)) ||
    Array.isArray(s.type) ||
    s.type === "null" ||
    Array.isArray(s.items) ||
    typeof s.items === "boolean"
  )
    return false;
  for (const k of ["items", "not", "additionalProperties"])
    if (typeof s[k] === "object" && !applicable(s[k])) return false;
  for (const k of ["oneOf", "anyOf", "allOf"])
    if (s[k] && !s[k].every(applicable)) return false;
  return !s.properties || Object.values(s.properties).every(applicable);
}
test("pinned independent Draft-04 vectors cover every OAS-shared validation keyword", () => {
  let assertions = 0,
    groups = 0,
    outside = 0;
  const dir = new URL("./vectors/draft4/", import.meta.url);
  for (const file of fs.readdirSync(dir).filter((n) => n.endsWith(".json")))
    for (const group of parseExact(
      fs.readFileSync(new URL(file, dir), "utf8"),
    )) {
      if (!applicable(group.schema)) {
        outside++;
        continue;
      }
      groups++;
      for (const c of group.tests) {
        assert.equal(
          validSchema(group.schema, c.data),
          c.valid,
          `${file}: ${group.description}: ${c.description}`,
        );
        assertions++;
      }
    }
  assert.ok(assertions >= 300);
  assert.ok(groups >= 70);
  console.log(
    JSON.stringify({
      independent_schema_assertions: assertions,
      groups,
      non_oas_schema_groups: outside,
      source_commit: "89e83a74014617ffbe79a56d83d14d054cd11417",
    }),
  );
});

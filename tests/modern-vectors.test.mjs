import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { parseExact } from "../platform/standard-value.mjs";
import { compileExactModern } from "../platform/modern-exact.mjs";
test("fixed upstream 2020-12 foundation vectors retain original bytes and run every selected assertion", () => {
  const root = new URL("./vectors/draft2020-12/", import.meta.url),
    manifest = JSON.parse(fs.readFileSync(new URL("manifest.json", root)));
  assert.equal(manifest.commit, "89e83a74014617ffbe79a56d83d14d054cd11417");
  let groups = 0,
    assertions = 0;
  const schemaRegistry = {};
  for (const [file, expected] of Object.entries(manifest.remotes)) {
    const raw = fs.readFileSync(new URL(file, root));
    assert.equal(
      createHash("sha1")
        .update("blob " + raw.length + "\0")
        .update(raw)
        .digest("hex"),
      expected,
      "upstream remote bytes changed: " + file,
    );
    if (!/\/(?:format-assertion|metaschema-)/.test(file))
      schemaRegistry["http://localhost:1234/" + file.slice("remotes/".length)] =
        parseExact(raw.toString("utf8"));
  }
  for (const [file, expected] of Object.entries(manifest.files)) {
    const raw = fs.readFileSync(new URL(file, root)),
      actual = createHash("sha1")
        .update("blob " + raw.length + "\0")
        .update(raw)
        .digest("hex");
    assert.equal(actual, expected, "upstream bytes changed: " + file);
    for (const group of parseExact(raw.toString("utf8"))) {
      let validate;
      try {
        validate = compileExactModern(group.schema, {}, { schemaRegistry });
      } catch (cause) {
        throw new Error(file + ": " + group.description, { cause });
      }
      groups++;
      for (const c of group.tests) {
        assert.equal(
          validate(c.data).valid,
          c.valid,
          `${file}: ${group.description}: ${c.description}`,
        );
        assertions++;
      }
    }
  }
  assert.equal(groups, 382);
  assert.equal(assertions, 1297);
  console.log(
    JSON.stringify({
      independent_modern_foundation_files: 45,
      groups,
      assertions,
      skipped: 0,
      full_json_schema_conformance_certified: false,
      full_openapi_3_1_or_3_2_execution: false,
    }),
  );
});

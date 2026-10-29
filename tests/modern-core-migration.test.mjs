import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { compileExactModern } from "../platform/modern-exact.mjs";
import { compileExactModern as reference } from "./reference/modern-exact-reference.mjs";
import { parseExact, LosslessNumber } from "../platform/standard-value.mjs";

test("MoonBit migration agrees with the frozen former JS evaluator on every pinned upstream instance", () => {
  const root = new URL("./vectors/draft2020-12/", import.meta.url);
  const manifest = JSON.parse(fs.readFileSync(new URL("manifest.json", root)));
  const registry = Object.create(null);
  for (const file of Object.keys(manifest.remotes))
    if (!/\/(?:format-assertion|metaschema-)/.test(file))
      registry["http://localhost:1234/" + file.slice(8)] = parseExact(
        fs.readFileSync(new URL(file, root), "utf8"),
      );
  let count = 0;
  for (const file of Object.keys(manifest.files)) {
    for (const group of parseExact(
      fs.readFileSync(new URL(file, root), "utf8"),
    )) {
      const next = compileExactModern(
        group.schema,
        {},
        { schemaRegistry: registry },
      );
      const former = reference(group.schema, {}, { schemaRegistry: registry });
      for (const item of group.tests) {
        assert.equal(
          next(item.data).valid,
          former(item.data).valid,
          `${file}: ${group.description}: ${item.description}`,
        );
        assert.equal(next(item.data).valid, item.valid);
        count++;
      }
    }
  }
  assert.equal(count, 1297);
});

test("MoonBit binary sidecar cannot be forged by business data and preserves nested exact equality", () => {
  const schema = { uniqueItems: true };
  for (const value of [
    [Buffer.from([0, 255]), Buffer.from([0, 255])],
    [Buffer.from([0, 255]), Buffer.from([0, 254])],
    [{ x: Buffer.from([1]) }, { x: Buffer.from([1]) }],
    [{ type: "Buffer", data: [1] }, Buffer.from([1])],
    [new LosslessNumber("1e-10000"), new LosslessNumber("10e-10001")],
  ]) {
    // The last value exceeds the declared lexical exponent budget in both engines.
    let a, b;
    try {
      a = compileExactModern(schema)(value).valid;
    } catch {
      a = "rejected";
    }
    try {
      b = reference(schema)(value).valid;
    } catch {
      b = "rejected";
    }
    assert.equal(a, b);
  }
  const data = JSON.parse('{"__proto__":null,"/~/":null}');
  assert.equal(
    compileExactModern({ propertyNames: { type: "string" } })(data).valid,
    true,
  );
});

test("MoonBit owns the evaluation path, cycle and shape budgets fail closed", () => {
  const source = fs.readFileSync(
    new URL("../platform/modern-exact.mjs", import.meta.url),
    "utf8",
  );
  assert.ok(source.includes("globalThis.__moonapi_modern("));
  assert.ok(!source.includes("const evaluate ="));
  assert.ok(!source.includes("tests/reference"));
  assert.throws(() => compileExactModern({ $ref: "#" })(0), /RESOURCE_BUDGET/);
  let deep = 0;
  for (let i = 0; i < 66; i++) deep = [deep];
  assert.throws(() => compileExactModern(true)(deep), /RESOURCE_BUDGET/);
});

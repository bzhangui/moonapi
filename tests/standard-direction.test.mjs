import test from "node:test";
import assert from "node:assert/strict";
import { validSchema } from "../platform/standard-schema.mjs";
import { StandardEngine } from "../platform/standard.mjs";
test("direction facts never leak from one successful choice into a different required branch", () => {
  for (const [mode, flag] of [
    ["write", "readOnly"],
    ["read", "writeOnly"],
  ]) {
    const s = {
      required: ["id"],
      oneOf: [{ properties: { id: { [flag]: true } } }, { required: ["id"] }],
    };
    assert.equal(validSchema(s, {}, mode), true);
    assert.equal(validSchema(s, { id: 1 }, mode), true);
  }
});
const composed = (flag, key = "id") => ({
  type: "object",
  required: [key, "name"],
  allOf: [
    {
      properties: {
        [key]: { type: "integer", [flag]: true },
        name: { type: "string" },
      },
    },
  ],
});
test("direction annotations cross allOf required boundaries, never object boundaries", () => {
  for (const [mode, flag] of [
    ["write", "readOnly"],
    ["read", "writeOnly"],
  ]) {
    const s = composed(flag);
    assert.equal(validSchema(s, { name: "owned" }, mode), true);
    assert.equal(validSchema(s, { name: "owned", id: 1 }, mode), false);
    assert.equal(validSchema(s, {}, mode), false);
    assert.equal(
      validSchema(s, { name: "owned" }, mode === "write" ? "read" : "write"),
      false,
    );
    assert.equal(
      validSchema(
        {
          allOf: [
            { required: ["id"] },
            { properties: { id: { [flag]: true } } },
          ],
        },
        {},
        mode,
      ),
      true,
    );
    assert.equal(
      validSchema(
        {
          required: ["id"],
          properties: { nested: { properties: { id: { [flag]: true } } } },
        },
        {},
        mode,
      ),
      false,
    );
    assert.equal(
      validSchema(
        {
          required: ["id"],
          not: { properties: { id: { [flag]: true } }, required: ["absent"] },
        },
        {},
        mode,
      ),
      false,
    );
    assert.equal(
      validSchema(
        {
          required: ["id"],
          anyOf: [
            {
              required: ["kind"],
              properties: { kind: { enum: ["a"] }, id: { [flag]: true } },
            },
            { required: ["kind"], properties: { kind: { enum: ["b"] } } },
          ],
        },
        { kind: "b" },
        mode,
      ),
      false,
    );
  }
});
test("standard worker validates composed request and response direction", async () => {
  const d = {
    openapi: "3.0.4",
    info: { title: "Direction", version: "1" },
    paths: {
      "/items": {
        post: {
          operationId: "create",
          requestBody: {
            required: true,
            content: { "application/json": { schema: composed("readOnly") } },
          },
          responses: {
            200: {
              description: "result",
              content: {
                "application/json": { schema: composed("writeOnly") },
              },
            },
          },
        },
      },
    },
  };
  const e = await StandardEngine.open(JSON.stringify(d));
  try {
    assert.equal(
      (
        await e.validateRequest({
          operation_id: "create",
          parameters: [],
          media: "application/json",
          body: { name: "owned" },
        })
      ).valid,
      true,
    );
    assert.equal(
      (
        await e.validateResponse(
          "create",
          200,
          { name: "owned" },
          { "content-type": "application/json" },
        )
      ).valid,
      true,
    );
  } finally {
    await e.close();
  }
});
test("seeded schema mutation/roundtrip properties retain direction and required controls", () => {
  let seed = 73;
  for (let i = 0; i < 160; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const k = "field" + seed,
      s = composed("readOnly", k),
      body = { name: "中文" + i };
    assert.equal(
      validSchema(
        JSON.parse(JSON.stringify(s)),
        JSON.parse(JSON.stringify(body)),
      ),
      true,
    );
    assert.equal(validSchema(s, { ...body, [k]: i }), false);
    assert.equal(validSchema(s, { ...body, name: 5 }), false);
    assert.equal(validSchema(s, {}), false);
  }
});

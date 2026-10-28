import test from "node:test";
import assert from "node:assert/strict";
import { probeModernSchema } from "../platform/modern-schema.mjs";
import { decodeSequence } from "../platform/sequence-media.mjs";
import { stringifyExact } from "../platform/standard-value.mjs";
const probe = (s, v, options) =>
  probeModernSchema(JSON.stringify(s), JSON.stringify(v), options);
test("2020-12 foundation checks booleans, ref siblings, dependent properties, evaluated members and tuple prefixes", async () => {
  for (const [schema, valid, invalid] of [
    [false, undefined, null],
    [{ type: ["integer", "null"] }, null, "x"],
    [
      {
        $defs: { text: { type: "string" } },
        $ref: "#/$defs/text",
        minLength: 3,
      },
      "abc",
      "a",
    ],
    [
      { type: "object", dependentRequired: { a: ["b"] } },
      { a: 1, b: 2 },
      { a: 1 },
    ],
    [
      {
        type: "object",
        allOf: [{ properties: { a: { type: "number" } } }],
        unevaluatedProperties: false,
      },
      { a: 1 },
      { a: 1, b: 2 },
    ],
    [
      {
        type: "array",
        prefixItems: [{ type: "string" }, { type: "integer" }],
        items: false,
      },
      ["a", 1],
      ["a", 1, 2],
    ],
    [
      {
        type: "array",
        contains: { const: "x" },
        minContains: 2,
        maxContains: 2,
      },
      ["x", "x"],
      ["x"],
    ],
    [
      {
        if: { type: "string" },
        then: { minLength: 2 },
        else: { type: "integer" },
      },
      "aa",
      "a",
    ],
  ]) {
    if (valid !== undefined)
      assert.equal((await probe(schema, valid)).valid, true);
    assert.equal((await probe(schema, invalid)).valid, false);
  }
});
test("dynamic references, annotation formats, no ambient resolution and exact-number refusal remain explicit", async () => {
  const tree = {
    $id: "https://schema.invalid/tree",
    $dynamicAnchor: "node",
    type: "object",
    properties: { child: { $dynamicRef: "#node" }, value: { type: "integer" } },
  };
  assert.equal((await probe(tree, { child: { value: 1 } })).valid, true);
  assert.equal((await probe(tree, { child: { value: "x" } })).valid, false);
  assert.equal(
    (await probe({ type: "string", format: "email" }, "not-email")).valid,
    true,
  );
  assert.equal(
    (
      await probe({ type: "string", format: "email" }, "not-email", {
        assertFormats: true,
      })
    ).valid,
    false,
  );
  await assert.rejects(
    probe({ $ref: "https://ungranted.invalid/private" }, 1),
    /INVALID_OR_UNGRANTED/,
  );
  await assert.rejects(
    probeModernSchema('{"const":9223372036854775807}', "9223372036854775807"),
    /EXACT_NUMBER_UNSUPPORTED/,
  );
  assert.equal(
    (await probe({ readOnly: true, type: "integer" }, 1)).valid,
    true,
  );
});
async function* chunks(text, width = 1) {
  const raw = Buffer.from(text);
  for (let i = 0; i < raw.length; i += width) yield raw.subarray(i, i + width);
}
test("incremental NDJSON and JSON sequence preserve UTF-8 and int64 over byte boundaries", async () => {
  for (const media of ["application/x-ndjson", "application/json-seq"]) {
    const line = '{"name":"中文😀","id":9223372036854775807}',
      text = media.endsWith("json-seq")
        ? "\x1e" + line + "\n\x1e" + line + "\n"
        : line + "\r\n" + line;
    const r = await decodeSequence(chunks(text), { media });
    assert.equal(r.items.length, 2);
    assert.equal(r.items[0].name, "中文😀");
    assert.match(stringifyExact(r.items[0]), /9223372036854775807/);
    assert.equal(r.openapi_execution_supported, false);
  }
});
test("SSE supports multiline data, CR/CRLF, comments, ids and discard of unfinished events", async () => {
  const r = await decodeSequence(
    chunks(
      "\uFEFF:comment\r\nid: id1\rdata: 中文\ndata: 二\nevent: item\r\nretry: 500\n\ndata: tail",
    ),
    { media: "text/event-stream" },
  );
  assert.deepEqual(r.items, [
    { data: "中文\n二", event: "item", id: "id1", retry: 500 },
  ]);
  assert.equal(r.discarded_unterminated_sse_event, true);
});
test("stream bounds and malformed/truncated records fail without partial success", async () => {
  for (const [text, settings, code] of [
    ['{"x":', {}, /JSON/],
    ["1\n2\n", { maxItems: 1 }, /ITEM_BUDGET/],
    ['"xxxx"', { maxBytes: 3 }, /BYTE_BUDGET/],
    ['"xxxx"', { maxItemBytes: 3 }, /RECORD_BUDGET/],
  ])
    await assert.rejects(
      decodeSequence(chunks(text), {
        media: "application/x-ndjson",
        ...settings,
      }),
      code,
    );
  await assert.rejects(
    decodeSequence(chunks("{}"), { media: "application/json-seq" }),
    /FRAMING/,
  );
  await assert.rejects(
    decodeSequence(chunks('\x1e{"x":'), { media: "application/json-seq" }),
    /JSON/,
  );
  async function* badUTF8() {
    yield Buffer.from([0xff]);
  }
  await assert.rejects(
    decodeSequence(badUTF8(), { media: "application/x-ndjson" }),
  );
  async function* emptyChunks() {
    for (let i = 0; i < 9000; i++) yield Buffer.alloc(0);
  }
  await assert.rejects(
    decodeSequence(emptyChunks(), {
      media: "application/x-ndjson",
      timeout: 30000,
    }),
    /CHUNK_BUDGET/,
  );
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    let returned = false;
    const never = {
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise(() => {}),
        return: () => {
          returned = true;
          return { done: true };
        },
      }),
    };
    await assert.rejects(
      decodeSequence(never, { media: "application/x-ndjson", timeout: 20 }),
      /DEADLINE/,
    );
    await Promise.resolve();
    assert.equal(returned, true);
  } finally {
    clearTimeout(keepAlive);
  }
});
test("modern schema regex compilation/validation is forcibly bounded outside the HTTP event loop", async () => {
  await assert.rejects(
    probeModernSchema(
      '{"type":"string","pattern":"^(a+)+$"}',
      JSON.stringify("a".repeat(50000) + "!"),
      { timeout: 100 },
    ),
    /CPU_BUDGET/,
  );
});

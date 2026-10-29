import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { ModernStreamState } from "../platform/modern-stream-state.mjs";
import {
  createModernStreamParser,
  encodeModernMedia,
} from "../platform/modern-media.mjs";
import { compileExactModern } from "../platform/modern-exact.mjs";
const validate = (schema, value) => compileExactModern(schema)(value).valid;
const options = { validate, timeout: 30000 };

test("byte-fed worker state preserves split UTF8/exact int64 and cannot complete before EOF", () => {
  const states = new ModernStreamState(),
    bytes = Buffer.from(
      '9223372036854775807\n"中文😀"\n{"exact":9007199254740993}\n',
    );
  const source = {
    itemSchema: {
      anyOf: [{ type: "integer" }, { type: "string" }, { type: "object" }],
    },
    schema: { type: "array", minItems: 3 },
  };
  assert.deepEqual(
    states.open({
      id: "unicode",
      media: "application/x-ndjson",
      content: source,
      options,
    }),
    { id: "unicode", complete: false, opened: true },
  );
  for (const byte of bytes) {
    const progress = states.chunk("unicode", [byte]);
    assert.equal(progress.complete, false);
    assert.equal(Object.hasOwn(progress, "value"), false);
    assert.ok(!JSON.stringify(progress).includes("中文"));
  }
  const result = states.end("unicode");
  assert.equal(result.complete, true);
  assert.equal(result.item_count, 3);
  assert.equal(result.bytes, bytes.length);
  assert.equal(String(result.value[0]), "9223372036854775807");
  assert.equal(result.value[1], "中文😀");
  assert.equal(String(result.value[2].exact), "9007199254740993");
  assert.deepEqual(states.summary(), {
    active: 0,
    terminal: 1,
    closed: false,
    persisted: false,
  });
  assert.throws(() => states.chunk("unicode", []), /NOT_OPEN/);
  assert.throws(
    () => states.open({ id: "unicode", media: "application/x-ndjson" }),
    /REUSED_ID/,
  );
});

test("a bad item aborts on its first completed record, before later chunks or EOF", () => {
  const states = new ModernStreamState();
  let observed = 0;
  states.open({
    id: "bad",
    media: "application/jsonl",
    content: { itemSchema: { type: "integer" } },
    options: { ...options, onItem: () => observed++ },
  });
  assert.throws(
    () => states.chunk("bad", Buffer.from('"private-body-never-echo"\n')),
    { message: "MODERN_SEQUENCE_ITEM_SCHEMA" },
  );
  assert.equal(observed, 0);
  assert.equal(states.summary().active, 0);
  assert.throws(() => states.chunk("bad", Buffer.from("1\n")), /NOT_OPEN/);
  assert.throws(() => states.end("bad"), /NOT_OPEN/);
});

test("malformed UTF8, pending code units and truncated JSON-sequence scalars fail closed", () => {
  for (const [id, media, bytes, atFeed, expected] of [
    ["utf8", "application/x-ndjson", Uint8Array.of(0xff), true, /UTF8/],
    [
      "pending",
      "application/x-ndjson",
      Uint8Array.of(0xe4, 0xb8),
      false,
      /UTF8/,
    ],
    [
      "json",
      "application/jsonl",
      Buffer.from('{"never-complete":'),
      false,
      /SEQUENCE_JSON/,
    ],
    [
      "scalar",
      "application/json-seq",
      Buffer.from("\x1e123"),
      false,
      /TRUNCATED_SCALAR/,
    ],
  ]) {
    const states = new ModernStreamState();
    states.open({ id, media, options });
    if (atFeed) assert.throws(() => states.chunk(id, bytes), expected);
    else {
      assert.equal(states.chunk(id, bytes).complete, false);
      assert.throws(() => states.end(id), expected);
    }
    assert.equal(states.summary().active, 0);
  }
});

test("multipart items validate incrementally and a missing closing boundary never completes", () => {
  const states = new ModernStreamState();
  states.open({
    id: "multipart",
    media: "multipart/mixed; boundary=bounded",
    content: { itemSchema: { type: "integer" } },
    options,
  });
  const first = Buffer.from(
    '--bounded\r\nContent-Type: application/json\r\n\r\n"wrong"\r\n--bounded\r\n',
  );
  assert.throws(() => states.chunk("multipart", first), /SCHEMA/);
  assert.equal(states.summary().active, 0);
  states.open({
    id: "truncated",
    media: "multipart/mixed; boundary=bounded",
    content: {},
    options,
  });
  states.chunk(
    "truncated",
    Buffer.from("--bounded\r\nContent-Type: text/plain\r\n\r\npending"),
  );
  assert.throws(() => states.end("truncated"), /MULTIPART_TRUNCATED/);
  const content = {
    schema: { type: "array", items: { type: "string" } },
    itemEncoding: { contentType: "text/plain" },
  };
  const encoded = encodeModernMedia(
    "multipart/mixed",
    ["中文", "tail"],
    content,
    options,
  );
  states.open({ id: "complete", media: encoded.contentType, content, options });
  for (const b of encoded.body)
    assert.equal(states.chunk("complete", Uint8Array.of(b)).complete, false);
  assert.deepEqual(states.end("complete").value, ["中文", "tail"]);
});

test("SSE requires explicit EOF and reports an unterminated discarded event without yielding it", () => {
  const states = new ModernStreamState();
  states.open({
    id: "sse",
    media: "text/event-stream",
    content: { itemSchema: { type: "object", required: ["data"] } },
    options,
  });
  assert.equal(
    states.chunk("sse", Buffer.from("data: completed\r\n\r\ndata: unfinished"))
      .complete,
    false,
  );
  const result = states.end("sse");
  assert.equal(result.item_count, 1);
  assert.equal(result.discarded_unterminated_sse_event, true);
  assert.deepEqual(result.value, [{ data: "completed" }]);
});

test("byte, record, item, chunk and active/terminal ownership budgets cannot be bypassed", () => {
  for (const [limit, first, second, expected] of [
    [{ maxBytes: 2 }, "1\n", "2\n", /BYTE_BUDGET/],
    [{ maxItems: 1 }, "1\n", "2\n", /ITEM_BUDGET/],
    [{ maxItemBytes: 2 }, "{", '"x":1}', /RECORD_BUDGET/],
    [{ maxChunks: 1 }, "", "", /CHUNK_BUDGET/],
  ]) {
    const parser = createModernStreamParser(
      "application/x-ndjson",
      {},
      { ...options, ...limit },
    );
    parser.feed(Buffer.from(first));
    assert.throws(() => parser.feed(Buffer.from(second)), expected);
    assert.equal(parser.summary().complete, false);
    assert.equal(parser.summary().state, "failed");
    assert.throws(() => parser.finish(), /CLOSED/);
  }
  const states = new ModernStreamState({ maxHistory: 2 });
  states.open({ id: "one", media: "application/x-ndjson", options });
  assert.throws(
    () => states.open({ id: "two", media: "application/x-ndjson", options }),
    /STATE_BUDGET/,
  );
  states.end("one");
  states.open({ id: "two", media: "application/x-ndjson", options });
  states.abort("two");
  assert.throws(
    () => states.open({ id: "three", media: "application/x-ndjson", options }),
    /STATE_BUDGET/,
  );
  states.close();
  assert.throws(
    () => states.open({ id: "fresh", media: "application/x-ndjson", options }),
    /STATE_CLOSED/,
  );
});

test("invalid byte commands, cancelled streams and monotonic deadlines stay terminal", async () => {
  const states = new ModernStreamState();
  states.open({ id: "shape", media: "application/x-ndjson", options });
  assert.throws(() => states.chunk("shape", [256]), /STREAM_CHUNK/);
  const controller = new AbortController(),
    parser = createModernStreamParser(
      "application/x-ndjson",
      {},
      { ...options, signal: controller.signal },
    );
  controller.abort(new Error("never echo private cancellation"));
  assert.throws(() => parser.feed(Buffer.from("1\n")), {
    message: "MODERN_STREAM_ABORTED",
  });
  const deadline = createModernStreamParser(
    "application/x-ndjson",
    {},
    { ...options, timeout: 10 },
  );
  await delay(20);
  assert.throws(() => deadline.finish(), /DEADLINE/);
  assert.equal(deadline.summary().complete, false);
});

test("registered json-seq structured suffixes use RFC7464 framing and full-schema checks occur only at EOF", () => {
  const parser = createModernStreamParser(
    "application/vnd.synthetic+json-seq",
    { schema: { type: "array", minItems: 2 } },
    options,
  );
  assert.equal(parser.feed(Buffer.from("\x1e1\n")).complete, false);
  assert.throws(() => parser.finish(), /MEDIA_SCHEMA/);
  const model = createModernStreamParser(
    "model/vnd.synthetic+json-seq",
    { itemSchema: { type: "integer" } },
    options,
  );
  model.feed(Buffer.from("\x1e1\n"));
  assert.equal(model.finish().value[0], 1);
});

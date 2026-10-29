import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  normalizeModernMethod,
  isReadOnlyMethod,
  encodeModernMedia,
  decodeModernMedia,
  encodeQuerystring,
  decodeQuerystring,
  validateModernContent,
  decodeModernStream,
  mediaSchema,
  serializeModernCookie,
  decodeModernCookie,
  encodeSetCookieHeader,
  decodeSetCookieHeader,
} from "../platform/modern-media.mjs";
import { encodeModernXML, decodeModernXML } from "../platform/modern-xml.mjs";
import { parseExact, stringifyExact } from "../platform/standard-value.mjs";

const same = (actual, expected) =>
  assert.equal(stringifyExact(actual), stringifyExact(expected));
const roundtrip = (media, value, content, options) => {
  const encoded = encodeModernMedia(media, value, content, options);
  const decoded = decodeModernMedia(
    encoded.contentType,
    encoded.body,
    content,
    options,
  );
  return { ...encoded, decoded };
};
const simpleValidate = (schema, value) => {
  if (schema === false) return false;
  if (schema === true || !schema) return true;
  if (schema.const !== undefined)
    return stringifyExact(value) === stringifyExact(schema.const);
  if (schema.type === "number" || schema.type === "integer")
    return typeof value === "number";
  if (schema.type === "string") return typeof value === "string";
  if (schema.type === "array")
    return (
      Array.isArray(value) &&
      (schema.maxItems === undefined || value.length <= schema.maxItems)
    );
  return true;
};
test("modern methods preserve case-sensitive custom tokens and QUERY has an explicit safe policy", () => {
  assert.equal(normalizeModernMethod("query", { fixed: true }), "QUERY");
  assert.equal(normalizeModernMethod("propfind"), "propfind");
  assert.equal(isReadOnlyMethod("QUERY"), true);
  assert.equal(isReadOnlyMethod("get"), false);
  assert.equal(isReadOnlyMethod("PROPFIND"), false);
  for (const m of ["GET\r\nX: y", "", "bad method", "é"])
    assert.throws(() => normalizeModernMethod(m), /METHOD_TOKEN/);
  assert.throws(
    () => normalizeModernMethod("PROPFIND", { fixed: true }),
    /METHOD_FIXED/,
  );
});
test("whole querystring form serialization is not named or double-encoded", () => {
  const p = {
      name: "unused",
      in: "querystring",
      content: {
        "application/x-www-form-urlencoded": {
          schema: {
            type: "object",
            properties: { foo: { type: "string" }, bar: { type: "boolean" } },
          },
        },
      },
    },
    value = { foo: "a + b", bar: true };
  const wire = encodeQuerystring(p, value);
  assert.equal(wire, "foo=a+%2B+b&bar=true");
  same(decodeQuerystring(p, wire), value);
  assert.ok(!wire.includes("unused="));
});
test("whole querystring JSON escapes URI delimiters once and preserves exact numbers", () => {
  const p = {
      name: "unused",
      in: "querystring",
      content: { "application/json": { schema: { type: "object" } } },
    },
    value = parseExact('{"value":9223372036854775807,"literal":"a&b#c+%"}');
  const wire = encodeQuerystring(p, value);
  assert.ok(wire.startsWith("%7B"));
  assert.ok(!wire.includes("#"));
  same(decodeQuerystring(p, wire), value);
  assert.throws(() => decodeQuerystring(p, "%ff"), /PERCENT_ENCODING/);
  assert.throws(
    () => encodeQuerystring({ ...p, style: "form" }, value),
    /QUERYSTRING_PARAMETER/,
  );
});
test("modern binary is byte-preserving and legacy format does not change string wire meaning", () => {
  const bytes = Buffer.from([0, 255, 128, 13, 10]);
  assert.deepEqual(roundtrip("image/png", bytes, {}).decoded, bytes);
  assert.equal(
    roundtrip("text/plain", "SGVsbG8=", {
      schema: { type: "string", format: "byte" },
    }).decoded,
    "SGVsbG8=",
  );
  assert.equal(
    roundtrip("text/plain", "你好", {
      schema: { type: "string", format: "binary" },
    }).body.toString(),
    "你好",
  );
  assert.equal(
    roundtrip("application/json", "SGVsbG8=", {
      schema: { type: "string", contentEncoding: "base64" },
    }).decoded,
    "SGVsbG8=",
  );
});
test("modern form defaults repeat array properties, serialize complex items and preserve prototype keys", () => {
  const value = parseExact(
    '{"names":["one","二 +"],"objects":[{"x":1},{"x":2}],"__proto__":"literal"}',
  );
  const content = {
    schema: {
      type: "object",
      properties: {
        names: { type: "array", items: { type: "string" } },
        objects: { type: "array", items: { type: "object" } },
        __proto__: undefined,
      },
      additionalProperties: { type: "string" },
    },
  };
  const r = roundtrip("application/x-www-form-urlencoded", value, content);
  same(r.decoded, value);
  assert.ok(r.body.toString().includes("names=one&names="));
  assert.equal(Object.getPrototypeOf(r.decoded), Object.prototype);
});
test("form complex encodings, tuple metadata, explicit styles and encoded binary remain distinct", () => {
  const content = {
    schema: {
      type: "object",
      properties: {
        code: { allOf: [{ type: ["number", "string"] }, { type: "string" }] },
        flags: { type: "array", items: { type: "boolean" } },
        binary: { type: "string", contentEncoding: "base64url" },
      },
    },
    encoding: { flags: { style: "form", explode: true } },
  };
  const value = { code: "1234", flags: [true, false], binary: "AA_-==" };
  same(
    roundtrip("application/x-www-form-urlencoded", value, content).decoded,
    value,
  );
  assert.equal(mediaSchema(content.schema.properties.code).type, "string");
  assert.throws(
    () =>
      decodeModernMedia(
        "application/x-www-form-urlencoded",
        Buffer.from("x=%q0"),
        {},
      ),
    /PERCENT_ENCODING/,
  );
});
test("ordered multipart tuples preserve nested documents, binary bytes and prefix/item encoding", () => {
  const content = {
    schema: {
      type: "array",
      prefixItems: [
        { type: "object" },
        {
          type: "array",
          prefixItems: [{ type: "string" }, { type: "string" }],
        },
      ],
      items: {},
    },
    prefixEncoding: [
      { contentType: "application/json" },
      {
        contentType: "multipart/mixed",
        prefixEncoding: [{ contentType: "text/plain" }],
        itemEncoding: { contentType: "text/plain" },
      },
    ],
    itemEncoding: { contentType: "image/png" },
  };
  const value = [
      { key: "value" },
      ["first", "第二"],
      Buffer.from([0, 255, 13, 10]),
    ],
    r = roundtrip("multipart/mixed", value, content);
  same(r.decoded.slice(0, 2), value.slice(0, 2));
  assert.deepEqual(r.decoded[2], value[2]);
  assert.ok(r.contentType.startsWith("multipart/mixed; boundary="));
});
test("named multipart repeats array values, supports nested media and verifies required part headers", () => {
  const content = {
    schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        objects: { type: "array", items: { type: "object" } },
      },
    },
    encoding: {
      title: {
        headers: { "X-Part": { required: true, schema: { const: "present" } } },
      },
    },
  };
  const value = { title: "Hello", objects: [{ x: 1 }, { x: 2 }] },
    r = roundtrip("multipart/form-data", value, content, {
      validate: simpleValidate,
    });
  same(r.decoded, value);
  assert.ok(r.body.includes("X-Part") || r.body.includes("x-part"));
  const corrupted = Buffer.from(
    r.body.toString().replace("x-part: present\r\n", ""),
  );
  assert.throws(
    () =>
      decodeModernMedia(r.contentType, corrupted, content, {
        validate: simpleValidate,
      }),
    /HEADER_REQUIRED/,
  );
});
test("multipart uses explicit media selection and never sniffs bytes or accepts ungranted types", () => {
  const content = {
      schema: { type: "array", items: {} },
      itemEncoding: { contentType: "image/png, image/jpeg" },
    },
    bytes = [Buffer.from([1, 2])];
  const encoded = encodeModernMedia("multipart/mixed", bytes, content, {
    partMediaTypes: { "/0": "image/jpeg" },
  });
  assert.ok(encoded.body.includes("image/jpeg"));
  assert.throws(
    () =>
      encodeModernMedia("multipart/mixed", bytes, content, {
        partMediaTypes: { "/0": "text/html" },
      }),
    /MEDIA_CHOICE/,
  );
  assert.throws(
    () =>
      encodeModernMedia("multipart/mixed", bytes, { ...content, encoding: {} }),
    /ENCODING_CONFLICT/,
  );
});
test("MIME transfer encoding follows contentEncoding, not the obsolete format hint", () => {
  const content = {
    schema: {
      type: "object",
      properties: { file: { type: "string", contentEncoding: "base64" } },
    },
  };
  const r = roundtrip("multipart/form-data", { file: "AP8=" }, content);
  assert.ok(r.body.includes("content-transfer-encoding: base64"));
  same(r.decoded, { file: "AP8=" });
  const bad = {
    ...content,
    encoding: {
      file: {
        headers: {
          "Content-Transfer-Encoding": { example: "quoted-printable" },
        },
      },
    },
  };
  assert.throws(
    () => encodeModernMedia("multipart/form-data", { file: "AP8=" }, bad),
    /TRANSFER_ENCODING_CONFLICT/,
  );
});
test("multipart parser handles preamble, epilogue and non-delimiter boundary bytes but rejects truncation and injection", () => {
  const content = {
      schema: { type: "array", items: {} },
      itemEncoding: { contentType: "application/octet-stream" },
    },
    r = encodeModernMedia("multipart/mixed", [Buffer.from("data")], content);
  const framed = Buffer.concat([
    Buffer.from("comment\r\n"),
    r.body,
    Buffer.from("epilogue"),
  ]);
  assert.deepEqual(
    decodeModernMedia(r.contentType, framed, content)[0],
    Buffer.from("data"),
  );
  assert.throws(
    () =>
      decodeModernMedia(
        r.contentType,
        r.body.subarray(0, r.body.length - 5),
        content,
      ),
    /TRUNCATED/,
  );
  assert.throws(
    () =>
      encodeModernMedia(
        "multipart/form-data",
        { "bad\r\nX:1": "x" },
        { schema: { type: "object" } },
      ),
    /PART_NAME/,
  );
  assert.throws(
    () =>
      encodeModernMedia("multipart/mixed", ["x"], {
        schema: { type: "array", items: { type: "string" } },
        itemEncoding: {
          headers: { "X-Injection": { example: "safe\r\nbad: true" } },
        },
      }),
    /PART_HEADER/,
  );
});
test("JSONL NDJSON JSON-seq and Geo JSON-seq map to exact ordered instance arrays", () => {
  const value = parseExact('[{"x":9223372036854775807},"中文",true,null]');
  for (const media of [
    "application/jsonl",
    "application/x-ndjson",
    "application/json-seq",
    "application/geo+json-seq",
  ])
    same(roundtrip(media, value, { schema: { type: "array" } }).decoded, value);
  assert.throws(
    () => decodeModernMedia("application/json-seq", Buffer.from("\x1e123")),
    /TRUNCATED_SCALAR/,
  );
  assert.throws(
    () => decodeModernMedia("application/json-seq", Buffer.from("\x1e1\n\x1e")),
    /SEQUENCE_JSON/,
  );
  assert.throws(
    () => decodeModernMedia("application/jsonl", Buffer.from("1\n\n2\n")),
    /EMPTY_JSONL/,
  );
});
test("whole schema and itemSchema are independent obligations and item validation can stop before EOF", async () => {
  assert.equal(
    validateModernContent(
      {
        schema: { type: "array", maxItems: 1 },
        itemSchema: { type: "number" },
      },
      [1, 2],
      simpleValidate,
    ),
    false,
  );
  assert.equal(
    validateModernContent(
      { schema: { type: "array" }, itemSchema: { type: "number" } },
      ["bad"],
      simpleValidate,
    ),
    false,
  );
  let returned = false,
    requested = 0;
  const chunks = {
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          requested++;
          return { done: false, value: Buffer.from('"bad"\n') };
        },
        return: async () => {
          returned = true;
          return { done: true };
        },
      };
    },
  };
  await assert.rejects(
    decodeModernStream(chunks, {
      media: "application/x-ndjson",
      content: { itemSchema: { type: "number" } },
      validate: simpleValidate,
    }),
    /ITEM_SCHEMA/,
  );
  await Promise.resolve();
  assert.equal(returned, true);
  assert.equal(requested, 1);
});
test("streaming UTF-8 may split at every byte without rounding exact values", async () => {
  const value = parseExact('[{"text":"😀中文","n":9223372036854775807}]'),
    bytes = encodeModernMedia("application/x-ndjson", value).body;
  const chunks = async function* () {
    for (const b of bytes) yield Buffer.from([b]);
  };
  const r = await decodeModernStream(chunks(), {
    media: "application/x-ndjson",
  });
  same(r.value, value);
  assert.equal(r.bytes, bytes.length);
  await assert.rejects(
    decodeModernStream(
      (async function* () {
        yield Buffer.from([0xf0, 0x9f]);
      })(),
      { media: "application/jsonl" },
    ),
    /encoded data|encoding|UTF/i,
  );
});
test("SSE data remains a string; multiline fields, ignored comments, reset retry and EOF obey wire parsing", () => {
  const raw = Buffer.from(
    ': ignored\r\nevent: addJSON\rdata: {"n":\r\ndata: 9223372036854775807}\rretry: 5\r\rdata: next\nunknown: ignored\n\ndata: not dispatched',
  );
  const r = decodeModernMedia("text/event-stream", raw);
  assert.equal(r.length, 2);
  assert.equal(r[0].data, '{"n":\n9223372036854775807}');
  assert.equal(typeof r[0].data, "string");
  assert.equal(r[0].retry, 5);
  assert.ok(!hasOwn(r[1], "retry"));
  assert.ok(!hasOwn(r[1], "unknown"));
  const value = [{ event: "message", data: "first\nsecond", retry: 3 }];
  same(
    roundtrip("text/event-stream", value).decoded,
    value.map(({ data, event, retry }) => ({ data, event, retry })),
  );
});
const hasOwn = (o, k) => Object.hasOwn(o, k);
test("media limits refuse byte/record/part/chunk floods and hung iterators without partial green results", async () => {
  assert.throws(
    () =>
      encodeModernMedia("text/plain", "x".repeat(1025), {}, { maxBytes: 1024 }),
    /BYTE_BUDGET/,
  );
  assert.throws(
    () =>
      decodeModernMedia(
        "application/x-ndjson",
        Buffer.from('"xxxxxxxx"\n'),
        {},
        { maxItemBytes: 4 },
      ),
    /RECORD_BUDGET/,
  );
  assert.throws(
    () =>
      encodeModernMedia(
        "multipart/mixed",
        Array.from({ length: 257 }, () => "x"),
        { schema: { type: "array", items: { type: "string" } } },
      ),
    /PART_BUDGET/,
  );
  await assert.rejects(
    decodeModernStream(
      (async function* () {
        await new Promise(() => {});
      })(),
      { media: "application/jsonl", timeout: 20 },
    ),
    /DEADLINE/,
  );
  await assert.rejects(
    decodeModernStream(
      (async function* () {
        for (;;) yield Buffer.alloc(0);
      })(),
      { media: "application/jsonl", timeout: 30000 },
    ),
    /CHUNK_BUDGET/,
  );
});

test("standalone hung stream owns a referenced deadline and cannot exit with an unresolved promise", () => {
  const code = `import { decodeModernStream } from ${JSON.stringify(new URL("../platform/modern-media.mjs", import.meta.url).href)};
 try {await decodeModernStream((async function*(){await new Promise(()=>{});})(),{media:'application/jsonl',timeout:20});process.exitCode=2;}
 catch(error){if(error.message!=='MODERN_STREAM_DEADLINE')throw error;console.log('bounded-deadline');}`;
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", code],
    { encoding: "utf8", timeout: 5000, windowsHide: true },
  );
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /bounded-deadline/);
  assert.equal(child.signal, null);
});
test("XML modern text CDATA namespaces and nil preserve structured values and exact integers", () => {
  const schema = {
      type: "object",
      xml: { name: "Report", namespace: "urn:reports", prefix: "r" },
      properties: {
        unit: { type: "string", xml: { nodeType: "attribute" } },
        value: { type: "integer", xml: { nodeType: "text" } },
        markup: { type: "string", xml: { nodeType: "cdata" } },
        optional: { type: ["string", "null"] },
      },
    },
    value = parseExact(
      '{"unit":"cubits","value":9223372036854775807,"markup":"<b>one]]>two</b>","optional":null}',
    );
  const raw = encodeModernXML(schema, value);
  assert.ok(raw.includes("<![CDATA["));
  assert.ok(raw.includes('xsi:nil="true"'));
  same(decodeModernXML(schema, raw), value);
});
test("XML ordered tuple elements and interspersed text retain declared order", () => {
  const schema = {
      type: "array",
      xml: { nodeType: "element", name: "Report" },
      prefixItems: [
        { type: "string", xml: { nodeType: "text" } },
        { type: "number", xml: { name: "data" } },
        { type: "string", xml: { nodeType: "text" } },
      ],
    },
    value = ["preamble", 42, "postamble"];
  assert.equal(
    encodeModernXML(schema, value),
    "<Report>preamble<data>42</data>postamble</Report>",
  );
  same(decodeModernXML(schema, encodeModernXML(schema, value)), value);
});
test("XML array nodeType none ignores wrapper name, component roots may supply inferred names", () => {
  const schema = {
      type: "object",
      properties: {
        animals: {
          type: "array",
          xml: { name: "ignored" },
          items: { type: "string", xml: { name: "animal" } },
        },
      },
    },
    value = { animals: ["dog", "cat"] },
    options = { rootName: "Document" };
  const raw = encodeModernXML(schema, value, options);
  assert.equal(
    raw,
    "<Document><animal>dog</animal><animal>cat</animal></Document>",
  );
  same(decodeModernXML(schema, raw, options), value);
  assert.throws(
    () => encodeModernXML({ type: "string" }, "unnamed"),
    /XML_NAME/,
  );
});
test("XML rejects entities, malformed names, ambiguous duplicates and illegal annotation combinations", () => {
  const schema = {
    type: "object",
    xml: { name: "root" },
    properties: { item: { type: "string" } },
  };
  assert.throws(
    () =>
      decodeModernXML(
        schema,
        '<!DOCTYPE root [<!ENTITY secret SYSTEM "file:///private">]><root>&secret;</root>',
      ),
    /DTD_FORBIDDEN|SYNTAX/,
  );
  assert.throws(
    () => decodeModernXML(schema, "<root><item>a</item><item>b</item></root>"),
    /DUPLICATE_ELEMENT/,
  );
  assert.throws(
    () => encodeModernXML({ type: "string", xml: { name: "bad name" } }, "x"),
    /XML_NAME/,
  );
  assert.throws(
    () =>
      encodeModernXML(
        {
          type: "array",
          xml: { name: "root", nodeType: "element", wrapped: true },
        },
        [],
      ),
    /ANNOTATION_CONFLICT/,
  );
  assert.throws(
    () => encodeModernXML({ type: "string", xml: { name: "root" } }, "\u0000"),
    /CHARACTER/,
  );
});
test("metadata type intersections and explicit schema refs retain non-JSON parsing types", () => {
  const content = {
      schema: {
        type: "object",
        properties: {
          integer: { allOf: [{ type: "number" }, { type: "integer" }] },
          other: { $ref: "urn:type:string" },
        },
      },
    },
    options = {
      resolveSchema: (s) =>
        s.$ref === "urn:type:string" ? { type: "string" } : s,
    };
  same(
    roundtrip(
      "application/x-www-form-urlencoded",
      { integer: 42, other: "1234" },
      content,
      options,
    ).decoded,
    { integer: 42, other: "1234" },
  );
  assert.throws(
    () =>
      encodeQuerystring(
        {
          in: "querystring",
          name: "x",
          schema: true,
          content: { "application/json": {} },
        },
        {},
      ),
    /QUERYSTRING_PARAMETER/,
  );
});
test("XML none objects flatten their attributes and child nodes without inventing wrapper elements", () => {
  const schema = {
      type: "object",
      xml: { name: "outer" },
      properties: {
        embedded: {
          type: "object",
          xml: { nodeType: "none" },
          properties: {
            id: { type: "integer", xml: { nodeType: "attribute" } },
            label: { type: "string" },
          },
        },
      },
    },
    value = { embedded: { id: 7, label: "seven" } };
  const raw = encodeModernXML(schema, value);
  assert.equal(raw, '<outer id="7"><label>seven</label></outer>');
  same(decodeModernXML(schema, raw), value);
});
test("XML preserves attribute whitespace, required null attributes and empty unwrapped lists", () => {
  const schema = {
      type: "object",
      xml: { name: "root" },
      required: ["nullable", "empty"],
      properties: {
        attr: { type: "string", xml: { nodeType: "attribute" } },
        text: { type: "string" },
        nullable: { type: ["integer", "null"], xml: { nodeType: "attribute" } },
        empty: { type: "array", items: { type: "string" } },
      },
    },
    value = {
      attr: "a\tb\nc\rd",
      text: "first\rsecond",
      nullable: null,
      empty: [],
    };
  same(decodeModernXML(schema, encodeModernXML(schema, value)), value);
  assert.throws(
    () =>
      decodeModernXML(
        { type: ["string", "null"], xml: { name: "root" } },
        '<root xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:nil="true">hidden</root>',
      ),
    /NIL_CONTENT/,
  );
});
test("XML namespace collisions, duplicated attribute aliases and adjacent ambiguous text fail before wire use", () => {
  assert.throws(
    () =>
      encodeModernXML(
        {
          type: "object",
          xml: { name: "root" },
          properties: {
            a: { xml: { name: "same", nodeType: "attribute" } },
            b: { xml: { name: "same", nodeType: "attribute" } },
          },
        },
        { a: "one", b: "two" },
      ),
    /DUPLICATE_ATTRIBUTE/,
  );
  assert.throws(
    () =>
      encodeModernXML(
        {
          type: "object",
          xml: { name: "root", prefix: "p", namespace: "urn:one" },
          properties: {
            a: {
              xml: { nodeType: "attribute", prefix: "p", namespace: "urn:two" },
            },
          },
        },
        { a: "value" },
      ),
    /NAMESPACE_COLLISION/,
  );
  assert.throws(
    () =>
      encodeModernXML(
        {
          type: "object",
          xml: { name: "root" },
          properties: {
            a: { xml: { nodeType: "text" } },
            b: { xml: { nodeType: "text" } },
          },
        },
        { a: "one", b: "two" },
      ),
    /AMBIGUOUS_TEXT/,
  );
});
test("SSE integer retry fields preserve arbitrary precision and accepted leading zeros", () => {
  const r = decodeModernMedia(
    "text/event-stream",
    Buffer.from("retry: 0009223372036854775807\ndata: x\n\n"),
  );
  assert.equal(String(r[0].retry), "9223372036854775807");
  same(
    roundtrip(
      "text/event-stream",
      parseExact('[{"data":"x","retry":9223372036854775807}]'),
    ).decoded,
    parseExact('[{"data":"x","retry":9223372036854775807}]'),
  );
});
test("cookie style uses semicolon separators without percent decoding or escaping", () => {
  const p = {
      in: "cookie",
      name: "cookie",
      style: "cookie",
      schema: {
        type: "object",
        properties: { greeting: { type: "string" }, code: { type: "integer" } },
      },
    },
    value = { greeting: "Hello%2C%20world!", code: 42 };
  const serialized = serializeModernCookie(p, value).join("; ");
  assert.equal(serialized, "greeting=Hello%2C%20world!; code=42");
  same(decodeModernCookie(p, serialized), value);
  assert.throws(
    () => serializeModernCookie(p, { greeting: "Hello, world!" }),
    /PREESCAPING/,
  );
  assert.throws(
    () => serializeModernCookie({ ...p, explode: false }, value),
    /COOKIE_PARAMETER/,
  );
});
test("cookie form percent semantics stay distinct, duplicate arrays stay ordered, controls cannot create headers", () => {
  const p = {
      in: "cookie",
      name: "greeting",
      style: "form",
      schema: { type: "string" },
    },
    value = "Hello, world!";
  const serialized = serializeModernCookie(p, value).join("; ");
  assert.equal(serialized, "greeting=Hello%2C%20world%21");
  assert.equal(decodeModernCookie(p, serialized), value);
  const array = {
    in: "cookie",
    name: "color",
    style: "cookie",
    schema: { type: "array", items: { type: "string" } },
  };
  assert.equal(
    serializeModernCookie(array, ["blue", "black"]).join("; "),
    "color=blue; color=black",
  );
  same(decodeModernCookie(array, "color=blue; color=black"), ["blue", "black"]);
  assert.throws(
    () => serializeModernCookie({ ...array, name: "bad\r\nX" }, ["x"]),
    /COOKIE_NAME/,
  );
  assert.throws(
    () => decodeModernCookie(array, "color=x\r\nInjected: yes"),
    /COOKIE_WIRE/,
  );
});
test("Set-Cookie values remain separate wire lines and never split the Expires comma or decode percent triples", () => {
  const header = {
      style: "simple",
      explode: true,
      schema: {
        type: "object",
        properties: { lang: { type: "string" }, foo: { type: "string" } },
      },
    },
    value = {
      lang: "en-US; Expires=Wed, 09 Jun 2021 10:18:14 GMT",
      foo: "Hello%2C%20world%21; Path=/",
    };
  const lines = encodeSetCookieHeader(header, value);
  assert.equal(lines.length, 2);
  same(decodeSetCookieHeader(header, lines), value);
  assert.ok(lines[0].includes("Wed, 09"));
  assert.ok(lines[1].includes("%2C%20"));
  const textHeader = {
      content: { "text/plain": { schema: { type: "string" } } },
    },
    text = lines.join("\n");
  assert.deepEqual(encodeSetCookieHeader(textHeader, text), lines);
  assert.equal(decodeSetCookieHeader(textHeader, lines), text);
  assert.throws(
    () => decodeSetCookieHeader(header, ["lang=en-US\r\nInjected: yes"]),
    /SET_COOKIE_LINE/,
  );
});
test("multipart streaming validates each completed part before EOF, preserving nested bytes across every chunk boundary", async () => {
  const content = {
      schema: { type: "array", prefixItems: [{ type: "string" }, {}] },
      prefixEncoding: [
        { contentType: "text/plain" },
        { contentType: "application/octet-stream" },
      ],
    },
    value = ["中文", Buffer.from([255, 0, 128])],
    r = encodeModernMedia("multipart/mixed", value, content),
    observed = [];
  const decoded = await decodeModernStream(
    (async function* () {
      for (const byte of r.body) yield Buffer.from([byte]);
    })(),
    {
      media: r.contentType,
      content,
      onItem: (item, index) => observed.push(index),
    },
  );
  assert.equal(decoded.value[0], value[0]);
  assert.deepEqual(decoded.value[1], value[1]);
  assert.deepEqual(observed, [0, 1]);
  const boundary = /boundary=([^;]+)/.exec(r.contentType)[1],
    firstBoundary = r.body.indexOf(Buffer.from("\r\n--" + boundary));
  let seen = 0;
  await assert.rejects(
    decodeModernStream(
      (async function* () {
        yield r.body.subarray(0, firstBoundary + boundary.length + 6);
        await new Promise(() => {});
      })(),
      {
        media: r.contentType,
        content,
        timeout: 20,
        onItem: () => {
          seen++;
        },
      },
    ),
    /DEADLINE/,
  );
  assert.equal(seen, 1);
});
test("multipart stream itemSchema failures stop before a second part or whole-message success", async () => {
  const encoded = encodeModernMedia("multipart/mixed", ["bad"], {
    schema: { type: "array", items: { type: "string" } },
    itemEncoding: { contentType: "text/plain" },
  });
  await assert.rejects(
    decodeModernStream(
      (async function* () {
        yield encoded.body;
      })(),
      {
        media: encoded.contentType,
        content: {
          itemSchema: { type: "number" },
          itemEncoding: { contentType: "text/plain" },
        },
        validate: simpleValidate,
      },
    ),
    /ITEM_SCHEMA/,
  );
});
test("MIME delimiter lookalikes inside data and preamble cannot truncate the instance", async () => {
  const media = "multipart/mixed; boundary=BOUNDARY",
    content = {
      schema: { type: "array", items: { type: "string" } },
      itemEncoding: { contentType: "text/plain" },
    };
  const text = "embedded --BOUNDARY\r\n--BOUNDARY--not-a-delimiter\r\nlast";
  const raw = Buffer.from(
    "preamble--BOUNDARY\r\n--BOUNDARYnot-valid\r\n--BOUNDARY \t\r\nContent-Type: text/plain\r\n\r\n" +
      text +
      "\r\n--BOUNDARY--\t\r\nepilogue",
  );
  same(decodeModernMedia(media, raw, content), [text]);
  const stream = await decodeModernStream(
    (async function* () {
      for (const b of raw) yield Buffer.from([b]);
    })(),
    { media, content },
  );
  same(stream.value, [text]);
});
test("quoted MIME parameter commas and legal spaced boundaries remain distinct from header injection", async () => {
  const content = {
    schema: { type: "array", items: { type: "string" } },
    itemEncoding: {
      contentType: 'text/plain; profile="a,b", application/json',
    },
  };
  const r = roundtrip("multipart/mixed", ["safe"], content);
  same(r.decoded, ["safe"]);
  assert.ok(r.body.includes('profile="a,b"'));
  assert.throws(
    () =>
      encodeModernMedia("multipart/mixed", ["safe"], {
        ...content,
        itemEncoding: {
          contentType: "text/plain; charset=utf-8\r\nInjected: yes",
        },
      }),
    /MEDIA_TYPE/,
  );
  const media = 'multipart/mixed; boundary="a b"',
    raw = Buffer.from(
      "--a b\r\nContent-Type: text/plain\r\n\r\nvalue\r\n--a b--\r\n",
    );
  same(decodeModernMedia(media, raw, content), ["value"]);
  same(
    (
      await decodeModernStream(
        (async function* () {
          yield raw;
        })(),
        { media, content },
      )
    ).value,
    ["value"],
  );
});

test("multipart explicit styles ignore contentType and child encodings while keeping MIME field ownership and literal percent bytes", () => {
  for (const [style, explode, value, expected] of [
    [
      "form",
      false,
      { inner: "ok%2C+中文", count: 2 },
      "inner,ok%2C+中文,count,2",
    ],
    [
      "form",
      true,
      { inner: "ok%2C+中文", count: 2 },
      "inner=ok%2C+中文&count=2",
    ],
    [
      "deepObject",
      true,
      { inner: "ok%2C+中文", count: 2 },
      "present[inner]=ok%2C+中文&present[count]=2",
    ],
    [
      "spaceDelimited",
      false,
      { inner: "ok%2C+中文", count: 2 },
      "inner ok%2C+中文 count 2",
    ],
    [
      "pipeDelimited",
      false,
      { inner: "ok%2C+中文", count: 2 },
      "inner|ok%2C+中文|count|2",
    ],
  ]) {
    const content = {
      schema: {
        type: "object",
        properties: {
          present: {
            type: "object",
            properties: {
              inner: { type: "string" },
              count: { type: "integer" },
            },
          },
        },
      },
      encoding: {
        present: {
          contentType: "multipart/mixed",
          style,
          explode,
          allowReserved: false,
          encoding: {
            inner: { headers: { Ignored: { required: true, schema: false } } },
          },
        },
      },
    };
    const result = roundtrip(
      "multipart/form-data",
      { present: value },
      content,
    );
    assert.ok(result.body.includes(Buffer.from(expected)), style);
    assert.match(result.body.toString(), /name="present"/);
    assert.match(result.body.toString(), /content-type: text\/plain/);
    assert.doesNotMatch(result.body.toString(), /Ignored|multipart\/mixed/);
    same(result.decoded, { present: value });
  }
});

test("multipart named array properties stay repeated parts and positional arrays use their own style without percent escaping", async () => {
  const content = {
      schema: {
        type: "object",
        properties: {
          values: { type: "array", items: { type: "integer" } },
          literal: { type: "string" },
        },
      },
      encoding: {
        values: { style: "form", explode: false },
        literal: { allowReserved: true },
      },
    },
    result = roundtrip(
      "multipart/form-data",
      { values: [1, 2], literal: "a&b,=%2C+中文" },
      content,
    );
  assert.equal(
    (result.body.toString().match(/name="values"/g) ?? []).length,
    2,
  );
  same(result.decoded, { values: [1, 2], literal: "a&b,=%2C+中文" });
  for (const [style, explode, expected] of [
    ["form", false, "1,2"],
    ["form", true, "0=1&0=2"],
    ["spaceDelimited", false, "1 2"],
    ["pipeDelimited", false, "1|2"],
  ]) {
    const c = {
        schema: {
          type: "array",
          items: { type: "array", items: { type: "integer" } },
        },
        itemEncoding: { style, explode, contentType: "application/xml" },
      },
      r = roundtrip("multipart/form-data", [[1, 2]], c);
    assert.ok(r.body.includes(Buffer.from(expected)), style);
    same(r.decoded, [[1, 2]]);
    const multiple = roundtrip(
      "multipart/form-data",
      [
        [1, 2],
        [3, 4],
      ],
      c,
    );
    same(multiple.decoded, [
      [1, 2],
      [3, 4],
    ]);
    same(
      (
        await decodeModernStream(
          (async function* () {
            yield multiple.body;
          })(),
          { media: multiple.contentType, content: c },
        )
      ).value,
      [
        [1, 2],
        [3, 4],
      ],
    );
  }
});

test("multipart style delimiters, undefined nested values and budgets fail explicitly instead of JSON fallback", () => {
  const content = {
    schema: {
      type: "object",
      properties: {
        field: { type: "object", properties: { key: { type: "string" } } },
      },
    },
    encoding: { field: { style: "form", explode: false } },
  };
  assert.throws(
    () =>
      encodeModernMedia(
        "multipart/form-data",
        { field: { key: "a,b" } },
        content,
      ),
    /FORM_STYLE_AMBIGUOUS/,
  );
  assert.throws(
    () =>
      encodeModernMedia(
        "multipart/form-data",
        { field: { key: { nested: true } } },
        content,
      ),
    /FORM_STYLE_NESTED/,
  );
  assert.throws(
    () =>
      encodeModernMedia(
        "multipart/form-data",
        { field: { key: "12345" } },
        content,
        { maxItemBytes: 3 },
      ),
    /RECORD_BUDGET/,
  );
  const encoded = encodeModernMedia(
    "multipart/form-data",
    { field: { key: "12345" } },
    content,
  );
  assert.throws(
    () =>
      decodeModernMedia(encoded.contentType, encoded.body, content, {
        maxItemBytes: 3,
      }),
    /RECORD_BUDGET/,
  );
  assert.throws(
    () =>
      encodeModernMedia(
        "multipart/form-data",
        { field: { key: "ok" }, another: "v" },
        content,
        { maxItems: 1 },
      ),
    /PART_BUDGET/,
  );
});

test("explicit named multipart mixed workaround round-trips repeated object items but ignores query style outside form-data", () => {
  const content = {
      schema: {
        type: "object",
        properties: {
          values: {
            type: "array",
            items: {
              type: "object",
              properties: { inner: { type: "string" } },
            },
          },
        },
      },
      encoding: {
        values: {
          contentType: "multipart/mixed",
          encoding: {
            inner: {
              contentType: "text/plain",
              style: "deepObject",
              headers: {
                Required: {
                  required: true,
                  schema: { type: "integer", const: 7 },
                  example: 7,
                },
              },
            },
          },
        },
      },
    },
    value = { values: [{ inner: "one" }, { inner: "two" }] },
    result = roundtrip("multipart/form-data", value, content, {
      validate: simpleValidate,
    });
  same(result.decoded, value);
  assert.equal((result.body.toString().match(/required: 7/gi) ?? []).length, 2);
  const outside = {
    schema: { type: "array", items: { type: "object" } },
    itemEncoding: {
      contentType: "application/json",
      style: "deepObject",
      explode: false,
    },
  };
  same(roundtrip("multipart/mixed", [{ raw: "a,b&c%2C" }], outside).decoded, [
    { raw: "a,b&c%2C" },
  ]);
});

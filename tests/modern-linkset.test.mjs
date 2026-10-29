import test from "node:test";
import assert from "node:assert/strict";
import { encodeLinkset, decodeLinkset } from "../platform/modern-linkset.mjs";

const one = (target = {}, anchor = "https://example.test/source") => ({
  linkset: [
    { anchor, next: [{ href: "https://example.test/target", ...target }] },
  ],
});

test("RFC9264 model round-trips contexts, targets, relation forms, and repeated attributes", () => {
  const model = {
    linkset: [
      {
        anchor: "https://example.test/one",
        next: [
          {
            href: "https://example.test/target;a,b?x=1&y=2",
            type: "text/html",
            hreflang: ["en", "de"],
            media: "screen and (width >= 20em)",
            title: 'A "quoted", \\ title',
            foo: ["one", "two"],
          },
          { href: "", title: "Current" },
        ],
        "https://example.test/relation;v=1,b": [{ href: "urn:example:item" }],
      },
      {
        anchor: "https://example.test/two",
        item: [{ href: "//cdn.example.test/path" }],
      },
    ],
  };
  const wire = encodeLinkset(model);
  assert.ok(!/[\r\n\u0080-\uffff]/.test(wire));
  assert.match(wire, /title="A \\"quoted\\", \\\\ title"/);
  assert.deepEqual(decodeLinkset(wire), model);
  assert.equal(encodeLinkset({ linkset: [] }), "");
  assert.deepEqual(decodeLinkset(" , , \t"), { linkset: [] });
});

test("RFC8288 relation lists expand, case-insensitive names normalize, and singleton first wins", () => {
  const decoded = decodeLinkset(
    '<x>; ReL="NEXT previous HTTPS://EXAMPLE.TEST/R"; rel="ignored"; ANCHOR="a"; anchor="ignored"; title=first; TITLE=second; type="text/plain"; type="application/json"; media=screen; media=print; hreflang=en; HREFLANG=de; foo=one; foo=two',
  );
  const context = decoded.linkset[0];
  assert.equal(context.anchor, "a");
  assert.deepEqual(Object.keys(context), [
    "anchor",
    "next",
    "previous",
    "https://example.test/r",
  ]);
  for (const rel of ["next", "previous", "https://example.test/r"]) {
    assert.deepEqual(context[rel][0], {
      href: "x",
      title: "first",
      type: "text/plain",
      media: "screen",
      hreflang: ["en", "de"],
      foo: ["one", "two"],
    });
  }
  assert.deepEqual(
    decodeLinkset('<x>; rel=next; flag; x=""').linkset[0].next[0],
    { href: "x", flag: [""], x: [""] },
  );
});

test("RFC8187 UTF8 language metadata, extensions, astral values, and BOM survive exactly", () => {
  const model = one({
    title: "Next chapter",
    "title*": [{ value: "nächstes Kapitel", language: "de" }],
    "name*": [
      { value: "中文 😺", language: "zh-Hans-CN" },
      { value: "\ufeffBOM" },
    ],
  });
  const wire = encodeLinkset(model);
  assert.match(wire, /title\*=UTF-8'de'n%C3%A4chstes%20Kapitel/);
  assert.match(wire, /%F0%9F%98%BA/);
  assert.deepEqual(decodeLinkset(Buffer.from(wire)), model);
  assert.deepEqual(
    decodeLinkset("<x>; rel=next; title*=ISO-8859-1'fr'caf%E9").linkset[0]
      .next[0]["title*"],
    [{ value: "café", language: "fr" }],
  );
  assert.equal(
    decodeLinkset("<x>; rel=next; foo*=ISO-8859-1''%80").linkset[0].next[0][
      "foo*"
    ][0].value.charCodeAt(0),
    128,
  );
});

test("internationalized title alternatives are independent valid links, never duplicate title* params", () => {
  const model = one({
    "title*": [
      { value: "First", language: "en" },
      { value: "Erste", language: "de" },
    ],
  });
  const wire = encodeLinkset(model);
  const targets = decodeLinkset(wire).linkset[0].next;
  assert.equal(targets.length, 2);
  assert.deepEqual(
    targets.flatMap((t) => t["title*"]),
    model.linkset[0].next[0]["title*"],
  );
  assert.equal(encodeLinkset(decodeLinkset(wire)), wire);
  assert.deepEqual(
    decodeLinkset(
      "<x>; rel=next; title*=UTF-8'en'first; title*=UTF-8'de'second",
    ).linkset[0].next[0]["title*"],
    [{ value: "first", language: "en" }],
  );
});

test("Unicode titles canonicalize through extended encoding; percent-encoded newlines cannot inject fields", () => {
  const wire = encodeLinkset(one({ title: "中文\r\nInjected: value\u0000" }));
  assert.ok(!/[\r\n\u0000]/.test(wire));
  assert.match(wire, /%0D%0AInjected/);
  assert.equal(
    decodeLinkset(wire).linkset[0].next[0]["title*"][0].value,
    "中文\r\nInjected: value\u0000",
  );
  assert.throws(
    () =>
      encodeLinkset(one({ title: "中文", "title*": [{ value: "Different" }] })),
    /NON_ASCII_FALLBACK/,
  );
  const extension = decodeLinkset(
    encodeLinkset(
      one({
        label: ["plain", "中文\r\nlabel"],
        "label*": [{ value: "French", language: "fr" }],
      }),
    ),
  ).linkset[0].next[0];
  assert.deepEqual(extension.label, ["plain"]);
  assert.deepEqual(extension["label*"], [
    { value: "French", language: "fr" },
    { value: "中文\r\nlabel" },
  ]);
});

test("standalone line separators work, but header mode and quoted or URI line breaks reject", () => {
  const source = '<a>; rel=next;\r\n title="A",\n<b>; rel=prev';
  assert.equal(decodeLinkset(source).linkset[0].next[0].title, "A");
  assert.throws(
    () => decodeLinkset(source, { header: true }),
    /HEADER_NEWLINE/,
  );
  for (const source of [
    "<a\n>; rel=next",
    '<a>; rel=next; title="bad\nheader"',
    '<a>; rel=next; title="bad\\\r\nheader"',
    "<a>; rel=next\r\nX-Evil: yes",
  ])
    assert.throws(() => decodeLinkset(source), /MODERN_LINKSET_/);
  assert.ok(
    !/[\r\n]/.test(encodeLinkset(decodeLinkset(source), { header: true })),
  );
});

test("URI references preserve generic syntax, or explicitly resolve with RFC3986 base semantics", () => {
  for (const href of [
    "",
    "/",
    "../item?q=x/y#f?z",
    "https://[2001:db8::1]:8080/a",
    "urn:example:a",
    "//user:pw@[v1.host:part]:99/a",
    "file:///tmp/test",
    "x:a%20b",
  ]) {
    const model = { linkset: [{ next: [{ href }] }] };
    assert.deepEqual(decodeLinkset(encodeLinkset(model)), model);
  }
  const baseURI = "http://a/b/c/d;p?q";
  for (const [ref, resolved] of [
    ["g:h", "g:h"],
    ["g", "http://a/b/c/g"],
    ["/g", "http://a/g"],
    ["//g", "http://g"],
    ["?y", "http://a/b/c/d;p?y"],
    ["#s", "http://a/b/c/d;p?q#s"],
    ["", "http://a/b/c/d;p?q"],
    ["..", "http://a/b/"],
    ["../../../g", "http://a/g"],
    ["g/../h", "http://a/b/c/h"],
    ["g?y/../x", "http://a/b/c/g?y/../x"],
    ["g#s/../x", "http://a/b/c/g#s/../x"],
  ]) {
    const target = decodeLinkset("<" + ref + ">; rel=next", { baseURI })
      .linkset[0];
    assert.equal(target.anchor, baseURI);
    assert.equal(target.next[0].href, resolved);
  }
  assert.equal(
    decodeLinkset('<../x>; rel=next; anchor="../source"', { baseURI })
      .linkset[0].anchor,
    "http://a/b/source",
  );
});

test("generic URI violations, malformed grammar and unsupported charsets fail without partial success", () => {
  for (const source of [
    "<x>",
    '<x>; rel=""',
    '<x>; rel=" next"',
    '<x>; rel="next\tprev"',
    '<x>; rel="relative/relation"',
    "<not a uri>; rel=next",
    "<x%GG>; rel=next",
    "<https://[bad]/x>; rel=next",
    "<https://a:abc/x>; rel=next",
    "<https://a/b[bad]>; rel=next",
    "<x>; rel=next; bad={oops}",
    '<x>; rel=next; title="unterminated',
    "<x>; rel=next; title=",
    "<x>; rel=next garbage",
    "<x>; rel=next; title*=UTF-8''%GG",
    "<x>; rel=next; title*=UTF-8''%C0%AF",
    "<x>; rel=next; title*=UTF-8''%ED%A0%80",
    "<x>; rel=next; title*=\"UTF-8''quoted\"",
    "<x>; rel=next; title*=ASCII''text",
    "<x>; rel=next; title*=UTF-8'invalid_tag'text",
    "<x>; rel=next, <malformed",
    "<中文>; rel=next",
    '<x>; rel=next; title="é"',
  ])
    assert.throws(() => decodeLinkset(source), /MODERN_LINKSET_/, source);
  assert.throws(() => decodeLinkset(new Uint8Array([0xc0, 0xaf])), /UTF8/);
  assert.throws(
    () => decodeLinkset(new Uint8Array([0xef, 0xbb, 0xbf, 0x3c, 0x3e])),
    /ASCII/,
  );
});

test("BCP47 language tags include grandfathered, private-use, extensions; malformed repetitions fail", () => {
  for (const tag of [
    "en",
    "zh-Hans-CN",
    "i-klingon",
    "sgn-BE-FR",
    "x-acme",
    "de-CH-1901",
    "en-Latn-US-a-extend-x-private",
    "abcd",
    "abcdefghi".slice(0, 8),
  ]) {
    const model = one({
      hreflang: [tag],
      "title*": [{ value: "title", language: tag }],
    });
    assert.deepEqual(decodeLinkset(encodeLinkset(model)), model);
  }
  for (const tag of [
    "",
    "en_US",
    "en--US",
    "en-a",
    "en-a-value-a-other",
    "de-1901-1901",
    "abcdefghi",
    "en-😺",
  ])
    assert.throws(() => encodeLinkset(one({ hreflang: [tag] })), /LANGUAGE/);
});

test("prototype-named target attributes stay own data and cannot mutate prototypes", () => {
  const target = JSON.parse(
    '{"href":"x","__proto__":["kept"],"constructor":["safe"],"toString":["value"]}',
  );
  const model = { linkset: [{ next: [target] }] };
  const decoded = decodeLinkset(encodeLinkset(model));
  assert.deepEqual(decoded.linkset[0].next[0].__proto__, ["kept"]);
  assert.deepEqual(decoded.linkset[0].next[0].constructor, ["safe"]);
  assert.deepEqual(decoded.linkset[0].next[0].tostring, ["value"]);
  assert.equal(
    Object.getPrototypeOf(decoded.linkset[0].next[0]),
    Object.prototype,
  );
  assert.equal(Object.prototype.kept, undefined);
});

test("deprecated inverse relations normalize direction only with a known context", () => {
  const model = decodeLinkset(
    '<https://example.test/target>; rel=next; rev=prev; anchor="https://example.test/source"; title="Label"',
  );
  assert.equal(model.linkset[0].next[0].href, "https://example.test/target");
  assert.equal(model.linkset[1].anchor, "https://example.test/target");
  assert.equal(model.linkset[1].prev[0].href, "https://example.test/source");
  assert.throws(
    () => decodeLinkset("<x>; rel=next; rev=prev"),
    /REVERSE_CONTEXT/,
  );
  assert.deepEqual(decodeLinkset(encodeLinkset(model)), model);
});

test("model cardinality, attribute ambiguity and unrepresentable JSON extensions reject explicitly", () => {
  for (const value of [
    null,
    [],
    {},
    { linkset: {} },
    { linkset: [], extra: true },
    { linkset: [{}] },
    { linkset: [{ anchor: "a" }] },
    { linkset: [{ next: {} }] },
    { linkset: [{ next: [] }] },
    { linkset: [{ next: [{}] }] },
    one({ foo: "not-array" }),
    one({ foo: [] }),
    one({ title: [] }),
    one({ type: "not-a-type" }),
    one({ rel: ["next"] }),
    one({ "title*": [{ value: "value", extra: true }] }),
    one({ "title*": [{ value: "\ud800" }] }),
    one({ FOO: ["one"], foo: ["two"] }),
  ])
    assert.throws(() => encodeLinkset(value), /MODERN_LINKSET_/);
});

test("bounded parsing and generation enforce bytes, contexts, links and attributes before success", () => {
  const model = one({ foo: ["one", "two"] });
  for (const options of [
    { maxBytes: 8 },
    { maxLinks: 0 },
    { maxAttributes: 2 },
    { maxBytes: Infinity },
    { maxContexts: 1025 },
    { header: "yes" },
  ])
    assert.throws(() => encodeLinkset(model, options), /MODERN_LINKSET_/);
  const wire = encodeLinkset(model);
  assert.throws(() => decodeLinkset(wire, { maxBytes: 8 }), /BYTE_LIMIT/);
  assert.throws(
    () => decodeLinkset(wire, { maxAttributes: 2 }),
    /ATTRIBUTE_LIMIT/,
  );
  assert.throws(
    () => decodeLinkset('<a>; rel="next prev"', { maxLinks: 1 }),
    /LINK_LIMIT/,
  );
  assert.throws(
    () =>
      decodeLinkset(
        '<a>; rel=next; anchor="one", <b>; rel=next; anchor="two"',
        { maxContexts: 1 },
      ),
    /CONTEXT_LIMIT/,
  );
  assert.throws(
    () =>
      encodeLinkset(
        { linkset: [{ next: [{ href: "a" }, { href: "b" }] }] },
        { maxLinks: 1 },
      ),
    /LINK_LIMIT/,
  );
  const many = Array.from(
    { length: 128 },
    (_, i) => `<x${i}>; rel=next; foo="${"a".repeat(128)}"`,
  ).join(",");
  assert.equal(decodeLinkset(many).linkset[0].next.length, 128);
  assert.throws(() => decodeLinkset(many, { maxLinks: 127 }), /LINK_LIMIT/);
});

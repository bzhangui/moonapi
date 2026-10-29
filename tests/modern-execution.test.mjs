import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { StandardEngine } from "../platform/standard.mjs";
import { parseExact, stringifyExact } from "../platform/standard-value.mjs";
import { ExecutionLedger } from "../platform/execution-ledger.mjs";
const response = (schema, media = "application/json") => ({
  description: "synthetic",
  content: { [media]: { schema } },
});
const doc = (version, paths, extra = {}) =>
  JSON.stringify({
    openapi: version,
    info: { title: "synthetic modern integration", version: "1" },
    paths,
    ...extra,
  });
async function fixture(handler) {
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}
const input = (id, body, media = "application/json", parameters = []) => ({
  operation_id: id,
  parameters,
  negative: false,
  ...(body === undefined ? {} : { body, media }),
});
test("native modern versions execute Schema references and numeric siblings without 3.0 projection", async () => {
  for (const version of ["3.1.2", "3.2.1"]) {
    const source = doc(
      version,
      {
        "/echo": {
          post: {
            operationId: "echo",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Value",
                    properties: { n: { exclusiveMinimum: 1 } },
                  },
                },
              },
            },
            responses: {
              200: response({ $ref: "#/components/schemas/Value" }),
            },
          },
        },
      },
      {
        components: {
          schemas: {
            Value: {
              type: "object",
              required: ["n", "tag"],
              properties: {
                n: { type: "integer", minimum: 1 },
                tag: { type: ["string", "null"], const: null },
              },
              additionalProperties: false,
            },
          },
        },
      },
    );
    const f = await fixture(async (req, res) => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(Buffer.concat(chunks));
    });
    const e = await StandardEngine.open(source, { allowWrite: true });
    try {
      assert.equal(e.description.openapi_version, version);
      assert.equal((await e.plan()).openapi_version, version);
      assert.equal(
        (await e.validateRequest(input("echo", { n: 1, tag: null }))).valid,
        false,
      );
      const r = await e.execute(f.base, input("echo", { n: 2, tag: null }));
      assert.equal(r.record.passed, true);
      assert.deepEqual(r.context.response.body, { n: 2, tag: null });
    } finally {
      await e.close();
      await f.close();
    }
  }
});
test("modern required/readOnly annotations and boolean false Schema retain 2020-12 semantics", async () => {
  const schema = {
    type: "object",
    required: ["id"],
    properties: { id: { type: "integer", readOnly: true } },
  };
  const source = doc("3.1.2", {
    "/x": {
      post: {
        operationId: "x",
        requestBody: { content: { "application/json": { schema } } },
        responses: { 200: response(false) },
      },
    },
  });
  const e = await StandardEngine.open(source, { allowWrite: true });
  try {
    assert.equal((await e.validateRequest(input("x", {}))).valid, false);
    assert.equal((await e.validateRequest(input("x", { id: 1 }))).valid, true);
    assert.equal(
      (
        await e.validateResponse(
          "x",
          200,
          {},
          { "content-type": "application/json" },
        )
      ).valid,
      false,
    );
  } finally {
    await e.close();
  }
});
test("3.2 QUERY body and whole-querystring serialize once and are read-only authorized", async () => {
  const parameter = {
    name: "filter",
    in: "querystring",
    required: true,
    content: {
      "application/x-www-form-urlencoded": {
        schema: {
          type: "object",
          required: ["q"],
          properties: { q: { type: "string" } },
          additionalProperties: false,
        },
      },
    },
  };
  const operation = {
    operationId: "search",
    parameters: [parameter],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["n"],
            properties: { n: { type: "integer", exclusiveMinimum: 1 } },
          },
        },
      },
    },
    responses: { 200: response({ const: "ok" }) },
  };
  let captured;
  const f = await fixture(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    captured = {
      method: req.method,
      url: req.url,
      body: Buffer.concat(chunks).toString(),
    };
    res.writeHead(200, { "content-type": "application/json" }).end('"ok"');
  });
  const e = await StandardEngine.open(
    doc("3.2.1", { "/search": { query: operation } }),
  );
  try {
    const r = await e.execute(
      f.base,
      input("search", { n: 2 }, "application/json", [
        { in: "querystring", name: "filter", value: { q: "中文 +&" } },
      ]),
    );
    assert.equal(r.record?.passed, true, JSON.stringify(r));
    assert.equal(captured.method, "QUERY");
    assert.equal(
      new URL(captured.url, f.base).searchParams.get("q"),
      "中文 +&",
    );
    assert.equal(captured.body, '{"n":2}');
  } finally {
    await e.close();
    await f.close();
  }
});
test("case-sensitive additional methods are never promoted to GET and retain the exact wire token", async () => {
  let method = "";
  const server = net.createServer((socket) =>
    socket.once("data", (b) => {
      method = b.toString().split(" ")[0];
      socket.end(
        "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok",
      );
    }),
  );
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const source = doc("3.2.1", {
    "/x": {
      additionalOperations: {
        get: {
          operationId: "custom",
          responses: { 200: response({ const: "ok" }, "text/plain") },
        },
      },
    },
  });
  for (const allowWrite of [false, true]) {
    const e = await StandardEngine.open(source, { allowWrite });
    try {
      const r = await e.execute(base, input("custom"));
      if (allowWrite) {
        assert.equal(r.record?.passed, true);
        assert.equal(method, "get");
      } else {
        assert.equal(r.record, undefined);
        assert.equal(method, "");
      }
    } finally {
      await e.close();
    }
  }
  await new Promise((r) => server.close(r));
});
test("sequential response itemSchema validates exact integers and malformed tails fail", async () => {
  const itemSchema = parseExact(
    '{"type":"integer","minimum":9223372036854775807}',
  );
  const source = stringifyExact({
    openapi: "3.2.1",
    info: { title: "synthetic stream", version: "1" },
    paths: {
      "/events": {
        get: {
          operationId: "events",
          responses: {
            200: { content: { "application/x-ndjson": { itemSchema } } },
          },
        },
      },
    },
  });
  let faulty = false;
  const f = await fixture((_req, res) =>
    res
      .writeHead(200, { "content-type": "application/x-ndjson" })
      .end(faulty ? "9223372036854775806\n" : "9223372036854775807\n"),
  );
  const e = await StandardEngine.open(source);
  try {
    assert.equal(
      (await e.execute(f.base, input("events"))).record.passed,
      true,
    );
    faulty = true;
    assert.equal(
      (await e.execute(f.base, input("events"))).record.passed,
      false,
    );
  } finally {
    await e.close();
    await f.close();
  }
});
test("raw binary remains bytes across request, worker response and observed context", async () => {
  const source = doc("3.1.2", {
    "/raw": {
      post: {
        operationId: "raw",
        requestBody: {
          required: true,
          content: { "application/octet-stream": { schema: {} } },
        },
        responses: { 200: response({}, "application/octet-stream") },
      },
    },
  });
  const bytes = Buffer.from([0, 255, 194, 0, 60]);
  const f = await fixture(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    res
      .writeHead(200, { "content-type": "application/octet-stream" })
      .end(Buffer.concat(chunks));
  });
  const e = await StandardEngine.open(source, { allowWrite: true });
  try {
    const r = await e.execute(
      f.base,
      input("raw", bytes, "application/octet-stream"),
    );
    assert.equal(r.record?.passed, true, JSON.stringify(r));
    assert.ok(Buffer.isBuffer(r.context.response.body));
    assert.deepEqual(r.context.response.body, bytes);
  } finally {
    await e.close();
    await f.close();
  }
});
test("3.2 optional response descriptions are unconstrained rather than fabricated contract faults", async () => {
  const f = await fixture((_req, res) => res.writeHead(200).end());
  const e = await StandardEngine.open(
    doc("3.2.1", { "/fire": { get: { operationId: "fire" } } }),
  );
  try {
    const contract = await e.validateResponse("fire", 200, undefined, {}, true);
    assert.equal(contract.valid, true);
    assert.equal(contract.unconstrained, true);
    const r = await e.execute(f.base, input("fire"));
    assert.equal(r.record.passed, true);
    assert.equal(r.record.response_contract_unspecified, true);
  } finally {
    await e.close();
    await f.close();
  }
});
test("live HTTP streaming rejects a bad item before EOF or a deliberately delayed tail", async () => {
  let tailSent = false;
  const f = await fixture((_req, res) => {
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    res.write('"bad-integer"\n');
    const timer = setTimeout(() => {
      tailSent = true;
      res.end("1\n");
    }, 2500);
    res.once("close", () => clearTimeout(timer));
  });
  const source = doc("3.2.1", {
    "/events": {
      get: {
        operationId: "events",
        responses: {
          200: {
            content: {
              "application/x-ndjson": { itemSchema: { type: "integer" } },
            },
          },
        },
      },
    },
  });
  const e = await StandardEngine.open(source, { timeout: 3000 });
  try {
    const start = performance.now(),
      r = await e.execute(f.base, input("events"));
    assert.equal(r.record.passed, false);
    assert.equal(r.record.category, "defect");
    assert.equal(r.record.stream_eof_verified, false);
    assert.equal(r.record.status, 200);
    assert.equal(tailSent, false);
    assert.ok(performance.now() - start < 2000);
  } finally {
    await e.close();
    await f.close();
  }
});
test("a valid observed prefix without HTTP EOF never becomes a complete passing stream", async () => {
  const f = await fixture((_req, res) => {
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    res.write("1\n");
  });
  const source = doc("3.2.1", {
    "/events": {
      get: {
        operationId: "events",
        responses: {
          200: {
            content: {
              "application/x-ndjson": { itemSchema: { type: "integer" } },
            },
          },
        },
      },
    },
  });
  const e = await StandardEngine.open(source, { timeout: 150 });
  try {
    const r = await e.execute(f.base, input("events"));
    assert.equal(r.record.passed, false);
    assert.equal(r.record.streamed, true);
    assert.equal(r.record.stream_eof_verified, false);
  } finally {
    await e.close();
    await f.close();
  }
});

test("modern Cookie and Set-Cookie execute without double escaping or splitting Expires", async () => {
  const schema = {
    type: "object",
    required: ["lang", "id"],
    properties: { lang: { type: "string" }, id: { type: "integer" } },
  };
  const source = doc("3.2.1", {
    "/cookie": {
      get: {
        operationId: "cookie",
        parameters: [
          {
            name: "session",
            in: "cookie",
            required: true,
            style: "cookie",
            schema,
          },
        ],
        responses: {
          200: {
            headers: {
              "Set-Cookie": {
                required: true,
                explode: true,
                schema: {
                  type: "object",
                  required: ["lang", "foo"],
                  properties: {
                    lang: {
                      type: "string",
                      const: "en; Expires=Wed, 09 Jun 2021 10:18:14 GMT",
                    },
                    foo: { type: "string", const: "x%2Cy" },
                  },
                },
              },
            },
            content: { "application/json": { schema: { const: true } } },
          },
        },
      },
    },
  });
  let wire;
  const f = await fixture((req, res) => {
    wire = req.headers.cookie;
    res
      .writeHead(200, {
        "set-cookie": [
          "lang=en; Expires=Wed, 09 Jun 2021 10:18:14 GMT",
          "foo=x%2Cy",
        ],
        "content-type": "application/json",
      })
      .end("true");
  });
  const e = await StandardEngine.open(source);
  try {
    const r = await e.execute(
      f.base,
      input("cookie", undefined, undefined, [
        {
          in: "cookie",
          name: "session",
          value: { lang: "Hello%2C%20world!", id: 42 },
        },
      ]),
    );
    assert.equal(r.record?.passed, true, JSON.stringify(r));
    assert.match(wire, /lang=Hello%2C%20world!/);
    assert.doesNotMatch(wire, /%252C/);
    assert.equal(r.context.response.header["set-cookie"].length, 2);
  } finally {
    await e.close();
    await f.close();
  }
});

test("native Link header decodes RFC9264 text inside a real HTTP response", async () => {
  const value = {
    linkset: [
      {
        anchor: "https://example.test/source",
        next: [{ href: "https://example.test/next", title: "Next, chapter" }],
      },
    ],
  };
  const source = doc("3.2.1", {
    "/link": {
      get: {
        operationId: "link",
        responses: {
          200: {
            headers: {
              Link: {
                required: true,
                content: {
                  "application/linkset": {
                    schema: { type: "object", const: value },
                  },
                },
              },
            },
            content: { "application/json": { schema: { const: true } } },
          },
        },
      },
    },
  });
  const f = await fixture((_req, res) =>
    res
      .writeHead(200, {
        link: '<https://example.test/next>; rel="next"; anchor="https://example.test/source"; title="Next, chapter"',
        "content-type": "application/json",
      })
      .end("true"),
  );
  const e = await StandardEngine.open(source);
  try {
    const r = await e.execute(f.base, input("link"));
    assert.equal(r.record?.passed, true, JSON.stringify(r));
  } finally {
    await e.close();
    await f.close();
  }
});

test("bounded header coercion is inconclusive rather than a confirmed API defect", async () => {
  const schema = {
    type: "array",
    items: { type: ["string", "integer"] },
    contains: { type: "integer" },
    minContains: 7,
  };
  const source = doc("3.2.1", {
    "/budget": {
      get: {
        operationId: "budget",
        responses: {
          200: {
            headers: { Values: { schema, required: true } },
            content: { "application/json": { schema: { const: true } } },
          },
        },
      },
    },
  });
  const f = await fixture((_req, res) =>
    res
      .writeHead(200, {
        values: "1,1,1,1,1,1,1",
        "content-type": "application/json",
      })
      .end("true"),
  );
  const e = await StandardEngine.open(source);
  try {
    const r = await e.execute(f.base, input("budget"));
    assert.equal(r.record.passed, false);
    assert.equal(r.record.inconclusive, true);
    assert.equal(r.record.category, "budget");
    assert.equal(r.record.status, 200);
  } finally {
    await e.close();
    await f.close();
  }
});

test("HTTP method ledger preserves custom case and treats only actual QUERY as safe", async () => {
  const ledger = await ExecutionLedger.open();
  try {
    for (const [i, method] of ["QUERY", "get", "Query", "SEARCH"].entries()) {
      for (const state of ["prepared", "dispatching", "sent", "unknown"])
        ledger.event(i + 1, state, { method });
    }
    assert.equal(ledger.summary().unknown_writes, 3);
    assert.throws(
      () => ledger.event(5, "prepared", { method: "GET\r\nX: y" }),
      /LEDGER_EVENT/,
    );
  } finally {
    ledger.close();
  }
});

test("modern explicit GET bodies are sent while prohibited TRACE request content is ignored", async () => {
  for (const method of ["get", "trace"]) {
    let bytes;
    const source = doc("3.2.1", {
      "/body": {
        [method]: {
          operationId: "body",
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { const: { ok: true } } },
            },
          },
          responses: { 200: response({ const: true }) },
        },
      },
    });
    const f = await fixture(async (req, res) => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      bytes = Buffer.concat(chunks).toString();
      res.writeHead(200, { "content-type": "application/json" }).end("true");
    });
    const e = await StandardEngine.open(source, { allowWrite: true });
    try {
      const r = await e.execute(
        f.base,
        input("body", method === "get" ? { ok: true } : undefined),
      );
      assert.equal(r.record?.passed, true, JSON.stringify(r));
      assert.equal(bytes, method === "get" ? '{"ok":true}' : "");
    } finally {
      await e.close();
      await f.close();
    }
  }
});

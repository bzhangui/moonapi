import http from "node:http";
export function feedbackSource() {
  const content = (schema) => ({
    description: "controlled",
    content: { "application/json": { schema } },
  });
  return JSON.stringify({
    openapi: "3.0.4",
    info: { title: "synthetic feedback", version: "1" },
    paths: {
      "/hints": {
        get: {
          operationId: "hints",
          responses: {
            200: content({
              type: "object",
              required: ["values"],
              properties: {
                values: {
                  type: "array",
                  items: { oneOf: [{ type: "string" }, { type: "integer" }] },
                },
              },
            }),
          },
        },
      },
      "/quote": {
        post: {
          operationId: "quote",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["code"],
                  properties: {
                    code: { type: "string", minLength: 1 },
                    extra: { type: "object" },
                  },
                },
              },
            },
          },
          responses: {
            200: content({
              type: "object",
              required: ["echo"],
              properties: { echo: { type: "string" } },
            }),
          },
        },
      },
    },
  });
}
export async function feedbackFixture({ fault = "" } = {}) {
  let requests = 0,
    writes = 0,
    resets = 0;
  const json = (res, value) =>
    res
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify(value));
  const server = http.createServer(async (req, res) => {
    requests++;
    try {
      if (req.method === "GET" && req.url === "/hints") {
        json(res, { values: ["alpha", "中文&ß", 17] });
        return;
      }
      if (req.method !== "POST" || req.url !== "/quote") {
        res.writeHead(404).end();
        return;
      }
      const chunks = [];
      let bytes = 0;
      for await (const c of req) {
        if ((bytes += c.length) > 262144) throw new Error();
        chunks.push(c);
      }
      const body = JSON.parse(Buffer.concat(chunks));
      if (typeof body.code !== "string" || !body.code) {
        res.writeHead(400).end();
        return;
      }
      writes++;
      if (fault === "lost") {
        req.socket.destroy();
        return;
      }
      json(res, {
        echo:
          fault === "unicode" && body.code === "中文&ß"
            ? "corrupted"
            : body.code,
      });
    } catch {
      if (!res.headersSent) res.writeHead(400);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    get requests() {
      return requests;
    },
    get writes() {
      return writes;
    },
    get resets() {
      return resets;
    },
    reset: async () => {
      resets++;
      return true;
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    },
  };
}
export function feedbackModel() {
  return {
    version: 2,
    initial_state: {},
    steps: [
      {
        id: "catalog",
        request: { operation_id: "hints", negative: false, parameters: [] },
        effects: ["catalogued"],
      },
      {
        id: "quote",
        requires: ["catalogued"],
        request: {
          operation_id: "quote",
          negative: false,
          parameters: [],
          media: "application/json",
          body: { code: "alpha", extra: { noise: "irrelevant long payload" } },
        },
        feedback_inputs: [
          { source: "codes", target: "$request.body#/code", required: true },
        ],
        shrink_inputs: ["$request.body#/extra"],
        assertions: [
          {
            id: "echo",
            kind: "equal",
            left: { from: "quote", expression: "$response.body#/echo" },
            right: { from: "quote", expression: "$request.body#/code" },
          },
        ],
      },
    ],
  };
}

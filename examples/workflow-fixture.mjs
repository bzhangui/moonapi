// Independent synthetic HTTP backend: no MoonAPI validator/codec imports.
import http from "node:http";
export function workflowSource() {
  const content = (schema) => ({ "application/json": { schema } });
  const response = (schema) => ({
    description: "fixture response",
    content: content(schema),
  });
  const id = { type: "integer", format: "int64" };
  const param = { in: "path", name: "id", required: true, schema: id };
  const item = { $ref: "#/components/schemas/Item" };
  const write = {
    required: true,
    content: content({
      type: "object",
      required: ["name"],
      properties: { name: { type: "string", minLength: 1 } },
    }),
  };
  const missing = { description: "missing" };
  return JSON.stringify({
    openapi: "3.0.4",
    info: { title: "Workflow controlled fixture", version: "1" },
    paths: {
      "/health": {
        get: {
          operationId: "health",
          responses: { 200: { description: "ok" } },
        },
      },
      "/items": {
        post: {
          operationId: "create",
          parameters: [
            {
              in: "header",
              name: "Idempotency-Key",
              schema: { type: "string" },
            },
          ],
          requestBody: write,
          responses: {
            201: {
              ...response(item),
              headers: { Location: { schema: { type: "string" } } },
              links: {
                read: {
                  operationId: "read",
                  parameters: { id: "$response.body#/id" },
                },
              },
            },
            400: missing,
          },
        },
      },
      "/items/{id}": {
        parameters: [param],
        get: {
          operationId: "read",
          responses: { 200: response(item), 404: missing },
        },
        patch: {
          operationId: "update",
          requestBody: write,
          responses: { 200: response(item), 404: missing, 400: missing },
        },
        delete: {
          operationId: "delete",
          responses: { 204: { description: "deleted" }, 404: missing },
        },
      },
      "/jobs": {
        post: {
          operationId: "submit",
          responses: {
            202: response({
              type: "object",
              required: ["id"],
              properties: { id },
            }),
          },
        },
      },
      "/jobs/{id}": {
        get: {
          operationId: "poll",
          parameters: [param],
          responses: {
            200: response({
              type: "object",
              required: ["state"],
              properties: {
                state: { type: "string", enum: ["pending", "done"] },
              },
            }),
          },
        },
      },
    },
    components: {
      schemas: {
        Item: {
          type: "object",
          required: ["id", "name"],
          properties: {
            id: { ...id, readOnly: true },
            name: { type: "string" },
          },
        },
      },
    },
  });
}
export async function workflowFixture({ fault = "", delay = 0 } = {}) {
  const items = new Map(),
    keys = new Map(),
    jobs = new Map();
  let serial = 9007199254741000n,
    requests = 0,
    creates = 0;
  const json = (res, status, value) =>
    res
      .writeHead(status, { "content-type": "application/json" })
      .end(JSON.stringify(value).replace(/"__integer:(\d+)"/g, "$1"));
  const server = http.createServer(async (req, res) => {
    requests++;
    try {
      const chunks = [];
      let size = 0;
      for await (const c of req) {
        size += c.length;
        if (size > 262144) {
          res.writeHead(413).end();
          return;
        }
        chunks.push(c);
      }
      if (delay) await new Promise((r) => setTimeout(r, delay));
      const route = req.url.split("?")[0],
        body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : undefined;
      if (route === "/health") {
        res.writeHead(200).end();
        return;
      }
      if (route === "/items" && req.method === "POST") {
        if (!body || typeof body.name !== "string" || !body.name) {
          res.writeHead(400).end();
          return;
        }
        const key = req.headers["idempotency-key"];
        const previous = key && keys.get(key);
        const id =
          previous && fault !== "idempotency" ? previous : String(++serial);
        if (!items.has(id)) {
          items.set(id, { id: "__integer:" + id, name: body.name });
          creates++;
        }
        if (key) keys.set(key, id);
        res.setHeader("location", "/items/" + id);
        if (fault === "committed_response_lost") {
          req.socket.destroy();
          return;
        }
        json(res, 201, items.get(id));
        return;
      }
      const match = /^\/items\/(\d+)$/.exec(route);
      if (match) {
        const item = items.get(match[1]);
        if (!item) {
          res.writeHead(404).end();
          return;
        }
        if (req.method === "PATCH") {
          if (!body || typeof body.name !== "string" || !body.name) {
            res.writeHead(400).end();
            return;
          }
          if (fault !== "persistence") item.name = body.name;
        }
        if (req.method === "DELETE") {
          if (fault !== "delete") items.delete(match[1]);
          res.writeHead(204).end();
          return;
        }
        json(res, 200, item);
        return;
      }
      if (route === "/jobs" && req.method === "POST") {
        const id = String(++serial);
        jobs.set(id, 0);
        json(res, 202, { id: "__integer:" + id });
        return;
      }
      const job = /^\/jobs\/(\d+)$/.exec(route);
      if (job && jobs.has(job[1])) {
        const n = jobs.get(job[1]) + 1;
        jobs.set(job[1], n);
        json(res, 200, {
          state: n >= 3 && fault !== "never_done" ? "done" : "pending",
        });
        return;
      }
      res.writeHead(404).end();
    } catch {
      if (!res.headersSent) res.writeHead(400);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    get requests() {
      return requests;
    },
    get creates() {
      return creates;
    },
    get remaining() {
      return items.size;
    },
    async reset(signal) {
      if (signal?.aborted) return false;
      items.clear();
      keys.clear();
      jobs.clear();
      return true;
    },
    async close() {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    },
  };
}

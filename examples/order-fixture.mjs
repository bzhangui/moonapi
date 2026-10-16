// Synthetic inventory/cancellation example, not a real external pilot.
import http from "node:http";
export function orderSource() {
  const integer = { type: "integer", minimum: 0, maximum: 1000 };
  const order = {
    type: "object",
    required: ["id", "status"],
    properties: {
      id: integer,
      status: { type: "string", enum: ["reserved", "cancelled"] },
    },
  };
  const response = (schema) => ({
    content: { "application/json": { schema } },
  });
  return JSON.stringify({
    openapi: "3.0.3",
    info: { title: "Synthetic inventory model", version: "1" },
    paths: {
      "/__test/reset": {
        post: { operationId: "reset", responses: { 204: {} } },
      },
      "/inventory": {
        get: {
          operationId: "inventory",
          responses: {
            200: response({
              type: "object",
              required: ["available"],
              properties: { available: integer },
            }),
          },
        },
      },
      "/orders": {
        post: {
          operationId: "reserve",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["quantity"],
                  properties: {
                    quantity: { type: "integer", minimum: 1, maximum: 3 },
                  },
                },
              },
            },
          },
          responses: { 201: response(order) },
        },
      },
      "/orders/{id}/cancel": {
        parameters: [
          { name: "id", in: "path", required: true, schema: integer },
        ],
        post: { operationId: "cancel", responses: { 200: response(order) } },
      },
    },
  });
}
export function orderModel() {
  return {
    format: 1,
    name: "idempotent_cancel",
    initial: { phase: "empty" },
    steps: [
      {
        id: "inventory_before",
        operationId: "inventory",
        capture: { original_stock: "/available" },
      },
      {
        id: "reserve",
        operationId: "reserve",
        requires: { phase: "empty" },
        set: { phase: "reserved" },
        body: { quantity: 2 },
        status: 201,
        capture: { order_id: "/id" },
      },
      {
        id: "cancel_once",
        operationId: "cancel",
        requires: { phase: "reserved" },
        set: { phase: "cancelled" },
        parameters: { id: { $from: "order_id" } },
        status: 200,
      },
      { id: "unrelated_read", operationId: "inventory" },
      {
        id: "cancel_twice",
        operationId: "cancel",
        requires: { phase: "cancelled" },
        set: { phase: "checked" },
        parameters: { id: { $from: "order_id" } },
        status: 200,
      },
      {
        id: "inventory_after",
        operationId: "inventory",
        requires: { phase: "checked" },
        assert: [
          {
            id: "inventory_conserved",
            pointer: "/available",
            op: "eq",
            expected: { $from: "original_stock" },
          },
        ],
      },
    ],
  };
}
export async function orderFixture({ doubleCredit = false } = {}) {
  let stock = 10,
    id = 0,
    resets = 0;
  const orders = new Map();
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 16384) {
        res.writeHead(413).end();
        return;
      }
      chunks.push(chunk);
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString());
    } catch {}
    const send = (status, data) => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(status === 204 ? "" : JSON.stringify(data));
    };
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/__test/reset" && req.method === "POST") {
      stock = 10;
      id = 0;
      orders.clear();
      resets++;
      send(204);
    } else if (url.pathname === "/inventory" && req.method === "GET")
      send(200, { available: stock });
    else if (
      url.pathname === "/orders" &&
      req.method === "POST" &&
      Number.isInteger(body?.quantity) &&
      body.quantity >= 1 &&
      body.quantity <= 3
    ) {
      const value = { id: ++id, status: "reserved", quantity: body.quantity };
      orders.set(id, value);
      stock -= value.quantity;
      send(201, { id, status: value.status });
    } else if (
      /^\/orders\/\d+\/cancel$/.test(url.pathname) &&
      req.method === "POST"
    ) {
      const order = orders.get(Number(url.pathname.split("/")[2]));
      if (!order) send(404, { error: "unknown order" });
      else {
        if (order.status === "reserved" || doubleCredit)
          stock += order.quantity;
        order.status = "cancelled";
        send(200, { id: order.id, status: order.status });
      }
    } else send(400, { error: "invalid request" });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    base: "http://127.0.0.1:" + server.address().port,
    get resets() {
      return resets;
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}

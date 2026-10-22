import http from "node:http";
export async function fixture({
  bug = false,
  invalidJson = false,
  slow = false,
  huge = false,
  acceptInvalid = false,
  redirect = null,
  enableReset = false,
  staleUpdate = false,
  ignoreDelete = false,
  unstableRead = false,
  ownershipDrift = false,
  loseCreateResponse = false,
  foreignCreateId = false,
} = {}) {
  const items = new Map();
  let id = 0,
    requests = 0,
    readCount = 0,
    resets = 0;
  const server = http.createServer(async (req, res) => {
    requests++;
    const url = new URL(req.url, "http://127.0.0.1");
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {}
    if (slow) await new Promise((resolve) => setTimeout(resolve, 100));
    if (redirect) {
      res.statusCode = 302;
      res.setHeader("location", redirect);
      res.end();
      return;
    }
    const reply = (status, value) => {
      res.statusCode = status;
      if (status === 204) {
        res.end();
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(
        huge
          ? "a".repeat(300000)
          : invalidJson
            ? "not-json"
            : JSON.stringify(value),
      );
    };
    const valid =
      body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      typeof body.name === "string" &&
      body.name.length >= 1 &&
      body.name.length <= 32;
    if (
      enableReset &&
      url.pathname === "/__test/reset" &&
      req.method === "POST"
    ) {
      items.clear();
      id = 0;
      resets++;
      reply(204);
    } else if (url.pathname === "/health" && req.method === "GET")
      reply(200, { ok: true });
    else if (url.pathname === "/echo" && req.method === "POST") {
      if (!valid)
        reply(
          acceptInvalid ? 200 : 400,
          acceptInvalid ? { name: "accepted" } : { error: "invalid" },
        );
      else reply(200, { name: bug ? 123 : body.name });
    } else if (url.pathname === "/items" && req.method === "POST") {
      if (!valid) reply(400, { error: "invalid" });
      else {
        const item = { id: ++id, name: body.name };
        items.set(id, item);
        if (loseCreateResponse) res.destroy();
        else reply(201, foreignCreateId ? { ...item, id: 90000 } : item);
      }
    } else if (/^\/items\/\d+$/.test(url.pathname)) {
      const key = Number(url.pathname.split("/").at(-1));
      if (!items.has(key)) reply(404, { error: "not found" });
      else if (req.method === "GET") {
        readCount++;
        if (ownershipDrift) items.set(key, { ...items.get(key), name: "foreign-owner" });
        reply(
          200,
          unstableRead && readCount % 2
            ? { ...items.get(key), name: "unstable" }
            : items.get(key),
        );
      } else if (req.method === "PUT") {
        if (!valid) reply(400, { error: "invalid" });
        else {
          const item = { id: key, name: body.name };
          if (!staleUpdate) items.set(key, item);
          reply(200, item);
        }
      } else if (req.method === "DELETE") {
        if (!ignoreDelete) items.delete(key);
        reply(204);
      } else reply(404, { error: "method not found" });
    } else reply(404, { error: "not found" });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    base: "http://127.0.0.1:" + server.address().port,
    items,
    get requests() {
      return requests;
    },
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

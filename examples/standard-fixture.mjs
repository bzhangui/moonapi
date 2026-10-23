import http from "node:http";

// Independent, stateless server logic: no MoonAPI/Enforcer validator in this
// server, no production data, no reset endpoint, no persistent side effects.
export async function startStandardFixture({ defect = false } = {}) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://fixture.invalid");
    let ok = false;
    if (req.method === "GET" && url.pathname === "/search") {
      const tags = url.searchParams.getAll("tags");
      ok =
        tags.length >= 1 &&
        tags.length <= 2 &&
        new Set(tags).size === tags.length &&
        tags.every((t) => ["blue", "red"].includes(t)) &&
        req.headers["x-client"] === "synthetic" &&
        req.headers.cookie === "session=fixture";
      if (ok) res.setHeader("x-count", "2");
    } else if (req.method === "POST" && url.pathname === "/quote") {
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 262144) {
          req.destroy();
          return;
        }
      }
      let value;
      try {
        value = JSON.parse(raw);
      } catch {}
      ok =
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Number.isInteger(value.quantity) &&
        value.quantity >= 1 &&
        value.quantity <= 10 &&
        typeof value.sku === "string" &&
        /^[A-Z]{3}$/.test(value.sku);
    } else {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(ok ? 200 : 400, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: defect && ok ? "deliberate-contract-defect" : Boolean(ok),
      }),
    );
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

// Disposable reference service: a fencing check and a mutation share ONE SQL
// transaction. A client lease hook alone cannot provide this guarantee.
import http from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { privateDirectory } from "../platform/private-store.mjs";
import { standardHTTP } from "../platform/standard-http.mjs";
export async function fencedSQLiteFixture(directory, { ttlMs = 5000 } = {}) {
  if (!Number.isInteger(ttlMs) || ttlMs < 100 || ttlMs > 600000)
    throw new Error("FENCE_TTL");
  const db = new DatabaseSync(
    path.join(privateDirectory(directory), randomUUID() + ".sqlite"),
  );
  db.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE lease (slot INTEGER PRIMARY KEY, epoch INTEGER NOT NULL, owner TEXT NOT NULL); INSERT INTO lease VALUES (1,0,''); CREATE TABLE counter (tenant TEXT PRIMARY KEY, value INTEGER NOT NULL);",
  );
  let requests = 0;
  let deadline = 0,
    current;
  const acquire = () => {
    if (current && performance.now() < deadline) throw new Error("FENCE_BUSY");
    const owner = randomUUID();
    db.prepare("UPDATE lease SET epoch=epoch+1,owner=? WHERE slot=1").run(
      owner,
    );
    const { epoch } = db.prepare("SELECT epoch FROM lease WHERE slot=1").get();
    deadline = performance.now() + ttlMs;
    return (current = { epoch, owner, ttlMs });
  };
  const valid = (token) => {
    const row = db.prepare("SELECT epoch,owner FROM lease WHERE slot=1").get();
    return (
      token?.epoch === row.epoch &&
      token?.owner === row.owner &&
      performance.now() < deadline
    );
  };
  const server = http.createServer(async (req, res) => {
    requests++;
    try {
      const tenant = new URL(req.url, "http://localhost").searchParams.get(
        "tenant",
      );
      if (!/^[a-z0-9-]{1,64}$/.test(tenant ?? "")) {
        res.writeHead(400).end();
        return;
      }
      if (req.method === "GET") {
        const value =
          db.prepare("SELECT value FROM counter WHERE tenant=?").get(tenant)
            ?.value ?? 0;
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ value }));
        return;
      }
      if (req.method !== "POST") {
        res.writeHead(405).end();
        return;
      }
      // Drain a bounded body before starting a transaction. No await occurs
      // between fencing check and commit, including during a delayed request.
      let bytes = 0;
      for await (const chunk of req)
        if ((bytes += chunk.length) > 1024) throw new Error("FENCE_BODY");
      db.exec("BEGIN IMMEDIATE");
      try {
        const token = {
          epoch: Number(req.headers["x-fence-epoch"]),
          owner: req.headers["x-fence-owner"],
        };
        if (!valid(token) || tenant !== token.owner) {
          db.exec("ROLLBACK");
          res.writeHead(409).end();
          return;
        }
        db.prepare(
          "INSERT INTO counter VALUES (?,1) ON CONFLICT(tenant) DO UPDATE SET value=value+1",
        ).run(tenant);
        db.exec("COMMIT");
        res.writeHead(204).end();
      } catch {
        db.exec("ROLLBACK");
        throw new Error("FENCE_TRANSACTION");
      }
    } catch {
      if (!res.headersSent) res.writeHead(400);
      res.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    get requests() {
      return requests;
    },
    acquire,
    async close() {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      db.close();
    },
    adapter: {
      version: 1,
      acquire: async () => acquire(),
      verify: async (token) => valid(token),
      release: async (token) => {
        // Releasing a stale owner can never revoke its successor.
        db.prepare(
          "UPDATE lease SET epoch=epoch+1,owner='' WHERE slot=1 AND epoch=? AND owner=?",
        ).run(token.epoch, token.owner);
        if (current?.owner === token.owner) {
          current = undefined;
          deadline = 0;
        }
        return true;
      },
    },
    transportFor: (token) => ({
      version: 1,
      id: "synthetic-sqlite-fence-v1",
      send: (url, request) =>
        standardHTTP(url, {
          ...request,
          headers: {
            ...request.headers,
            "x-fence-epoch": String(token.epoch),
            "x-fence-owner": token.owner,
          },
        }),
    }),
    evidence:
      "single-process synthetic SQLite; not a distributed lock or production adapter",
  };
}

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { VERSION, Engine } from "./runner.mjs";
import { parseDefinition } from "./definition.mjs";
import { inspectDialect } from "./dialects.mjs";
import { inspectProject, runProject } from "./project-config.mjs";
import { publicReport } from "./ci-tools.mjs";
import {
  privateDirectory,
  saveEncryptedWitness,
  loadEncryptedWitness,
} from "./private-store.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const assets = new Map([
  ["/", ["workbench/index.html", "text/html"]],
  ["/app.js", ["workbench/app.js", "text/javascript"]],
  ["/app.css", ["workbench/app.css", "text/css"]],
  [
    "/assets/primer.css",
    ["node_modules/@primer/css/dist/primer.css", "text/css"],
  ],
]);
const tokenRoot = path.join(root, "node_modules/@primer/primitives/dist/css");
for (const file of fs.readdirSync(tokenRoot, { recursive: true }))
  if (file.endsWith(".css"))
    assets.set("/assets/tokens/" + file.replaceAll(path.sep, "/"), [
      "node_modules/@primer/primitives/dist/css/" + file,
      "text/css",
    ]);
export async function startWorkbench({
  port = 8791,
  allowWrite = false,
  allowRemote = false,
  allowedOrigins = [],
  profileDirectory,
  profileKey,
  credentialProvider,
  demo,
} = {}) {
  if (
    !Number.isInteger(port) ||
    port < 0 ||
    port > 65535 ||
    !Array.isArray(allowedOrigins)
  )
    throw new Error("WORKBENCH_OPTIONS");
  const origins = new Set(allowedOrigins.map((x) => new URL(x).origin));
  if (profileDirectory) {
    if (!Buffer.isBuffer(profileKey) || profileKey.length !== 32)
      throw new Error("WORKBENCH_PROFILE_KEY");
    profileDirectory = privateDirectory(profileDirectory, { create: true });
  }
  const token = randomBytes(32).toString("base64url");
  let inspecting = false;
  let origin,
    job = { state: "idle" },
    engine,
    closing = false;
  const secureEqual = (a, b) => {
    const x = Buffer.from(a ?? ""),
      y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  };
  const server = http.createServer(async (req, res) => {
    const send = (status, value, type = "application/json") => {
      res.writeHead(status, {
        "content-type": type + "; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "content-security-policy":
          "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      });
      res.end(typeof value === "string" ? value : JSON.stringify(value));
    };
    try {
      if (
        req.headers.host !== new URL(origin).host ||
        (req.headers.origin && req.headers.origin !== origin)
      )
        return send(403, { error: "ORIGIN_DENIED" });
      const url = new URL(req.url, origin);
      if (url.search) return send(400, { error: "QUERY_DENIED" });
      if (req.method === "GET" && assets.has(url.pathname)) {
        const [file, type] = assets.get(url.pathname);
        return send(200, fs.readFileSync(path.join(root, file), "utf8"), type);
      }
      if (
        !url.pathname.startsWith("/api/") ||
        !secureEqual(req.headers.authorization, "Bearer " + token)
      )
        return send(401, { error: "SESSION_REQUIRED" });
      if (req.method === "GET" && url.pathname === "/api/session")
        return send(200, {
          version: VERSION,
          write_capability: allowWrite,
          remote_capability: allowRemote,
          encrypted_profiles: !!profileDirectory,
          synthetic_demo: !!demo,
          demo: demo ? { source: demo.source, base: demo.base } : undefined,
        });
      if (req.method === "GET" && url.pathname === "/api/status")
        return send(200, job);
      if (
        req.method !== "POST" ||
        !/^application\/json(?:;|$)/i.test(req.headers["content-type"] ?? "")
      )
        return send(415, { error: "JSON_REQUIRED" });
      let size = 0,
        chunks = [];
      for await (const c of req) {
        size += c.length;
        if (size > 1400000) {
          send(413, { error: "INPUT_BUDGET" });
          req.destroy();
          return;
        }
        chunks.push(c);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (url.pathname === "/api/inspect") {
        if (inspecting) return send(409, { error: "ONE_INSPECTION_AT_A_TIME" });
        inspecting = true;
        try {
          const version = parseDefinition(body.source)?.openapi;
          if (!version?.startsWith("3.0."))
            return send(200, {
              dialect: await inspectDialect(body.source, {
                documents: body.documents ?? {},
              }),
              operations: [],
              execution_supported: false,
            });
          return send(200, {
            ...(await inspectProject(body.source, {
              documents: body.documents ?? {},
            })),
            execution_supported: true,
          });
        } finally {
          inspecting = false;
        }
      }
      if (url.pathname === "/api/cancel") {
        if (job.state === "running") {
          job.cancel_requested = true;
          await engine?.close();
        }
        return send(200, {
          requested: true,
          remote_effects_not_rolled_back: true,
        });
      }
      if (url.pathname === "/api/profile-save") {
        if (!profileDirectory)
          return send(409, { error: "ENCRYPTED_STORAGE_NOT_CONFIGURED" });
        if (fs.readdirSync(profileDirectory).length >= 10)
          return send(409, { error: "PROFILE_BUDGET" });
        const id = randomUUID();
        saveEncryptedWitness(
          path.join(profileDirectory, id + ".json"),
          { format: 1, profile: body.profile },
          profileKey,
        );
        return send(201, { id });
      }
      if (url.pathname === "/api/profile-load") {
        if (!profileDirectory || !/^[-a-f0-9]{36}$/.test(body.id))
          return send(400, { error: "PROFILE_ID" });
        return send(200, {
          profile: loadEncryptedWitness(
            path.join(profileDirectory, body.id + ".json"),
            profileKey,
          ).profile,
        });
      }
      if (url.pathname !== "/api/run") return send(404, { error: "NOT_FOUND" });
      if (job.state === "running")
        return send(409, { error: "ONE_RUN_AT_A_TIME" });
      if (body.allowWrite && !allowWrite)
        return send(403, { error: "WRITE_NOT_GRANTED_AT_STARTUP" });
      if (body.allowCleanup && !body.allowWrite)
        return send(403, { error: "CLEANUP_REQUIRES_WRITE" });
      const target = new Engine("{}", { allowRemote }).base(body.base),
        targetURL = new URL(target);
      if (
        !["127.0.0.1", "localhost", "[::1]"].includes(targetURL.hostname) &&
        (!allowRemote || !origins.has(targetURL.origin))
      )
        return send(403, { error: "TARGET_ORIGIN_NOT_GRANTED_AT_STARTUP" });
      job = {
        id: randomUUID(),
        state: "running",
        cancel_requested: false,
        synthetic: !!demo,
        started_at: Date.now(),
      };
      const current = job;
      runProject(body, {
        allowWrite: body.allowWrite === true,
        allowRemote,
        allowCleanup: body.allowCleanup === true,
        credentialProvider,
        onEngine: (e) => {
          engine = e;
          if (closing || current.cancel_requested) void e.close();
        },
      })
        .then((report) => {
          current.state = current.cancel_requested ? "cancelled" : "finished";
          current.report = publicReport(report);
        })
        .catch(() => {
          current.state = current.cancel_requested ? "cancelled" : "failed";
          current.error = "EXECUTION_BLOCKED_OR_FAILED_CONTENTS_HIDDEN";
        })
        .finally(() => {
          current.finished_at = Date.now();
          engine = undefined;
        });
      return send(202, { id: job.id });
    } catch {
      return send(400, { error: "INPUT_OR_POLICY_CONTENTS_HIDDEN" });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.maxConnections = 16;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    url: origin + "/#" + token,
    token,
    async close() {
      closing = true;
      await engine?.close();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    },
  };
}

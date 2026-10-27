// Optional comparison against a separately installed, pinned reference tool.
// Same owned backend/spec/seed/timeouts, NOT identical generators or case counts.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { StandardEngine } from "../platform/standard.mjs";
const argument = process.argv[2];
if (!argument) throw new Error("Pass Schemathesis 4.32.5 executable");
const tool = fs.existsSync(argument) ? path.resolve(argument) : argument;
const version = spawnSync(tool, ["--version"], {
  encoding: "utf8",
  windowsHide: true,
});
if (version.status !== 0 || !version.stdout.includes("4.32.5"))
  throw new Error("Pinned reference version required");
const parent = fileURLToPath(
  new URL("../.local/comparisons/", import.meta.url),
);
fs.mkdirSync(parent, { recursive: true });
const root = fs.mkdtempSync(path.join(parent, "same-backend-"));
const spec = {
  openapi: "3.0.4",
  info: { title: "Isolated comparison fixture", version: "1" },
  paths: {
    "/quote": {
      get: {
        operationId: "quote",
        parameters: [
          {
            in: "query",
            name: "kind",
            required: true,
            schema: { type: "string", enum: ["a", "b"] },
          },
        ],
        responses: {
          200: {
            description: "quote",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["price"],
                  properties: { price: { type: "integer" } },
                },
              },
            },
          },
          400: { description: "invalid" },
        },
      },
    },
  },
};
const source = JSON.stringify(spec),
  filename = path.join(root, "spec.json");
fs.writeFileSync(filename, source, { flag: "wx" });
const results = [];
for (const fault of ["", "schema", "server", "negative_accepted"]) {
  let requests = 0;
  const s = http.createServer((req, res) => {
    requests++;
    const kind = new URL(req.url, "http://127.0.0.1").searchParams.get("kind"),
      valid = ["a", "b"].includes(kind);
    if (!valid && fault !== "negative_accepted") {
      res.writeHead(400).end();
      return;
    }
    if (fault === "server") {
      res.writeHead(500).end();
      return;
    }
    res
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ price: fault === "schema" ? "wrong" : 7 }));
  });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${s.address().port}`;
  let engine;
  try {
    engine = await StandardEngine.open(source, {
      seed: 73,
      limit: 32,
      timeout: 2000,
      totalTimeout: 10000,
    });
    const start = Date.now(),
      moon = await engine.run(base),
      moonRequests = requests;
    requests = 0;
    const args = [
      "run",
      filename,
      "--url",
      base,
      "--phases",
      "coverage",
      "--max-examples",
      "8",
      "--seed",
      "73",
      "--workers",
      "1",
      "--checks",
      "not_a_server_error,status_code_conformance,content_type_conformance,response_schema_conformance,negative_data_rejection,positive_data_acceptance",
      "--request-timeout",
      "2",
      "--request-retries",
      "0",
      "--generation-database",
      "none",
    ];
    const moonMs = Date.now() - start,
      referenceStart = Date.now();
    const result = await new Promise((resolve, reject) => {
      const child = spawn(tool, args, {
        cwd: root,
        env: { ...process.env, NO_COLOR: "1", PYTHONUTF8: "1" },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      const collect = (b) => {
        if (output.length < 1048576) output += b.toString();
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("Reference comparison timeout"));
      }, 60000);
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, output });
      });
    });
    fs.writeFileSync(
      path.join(root, (fault || "healthy") + ".private.log"),
      result.output,
      { flag: "wx", mode: 0o600 },
    );
    if (![0, 1].includes(result.code))
      throw new Error("Reference CLI failed; inspect private comparison log");
    results.push({
      fixture: fault || "healthy",
      expected_failure: !!fault,
      moonapi: {
        passed: moon.passed,
        requests: moonRequests,
        elapsed_ms: moonMs,
      },
      schemathesis: {
        exit: result.code,
        requests,
        elapsed_ms: Date.now() - referenceStart,
      },
      same_inputs: false,
    });
  } finally {
    await engine?.close();
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
}
const report = {
  reference: "Schemathesis 4.32.5",
  moonapi: "0.4.0",
  seed: 73,
  per_request_timeout_ms: 2000,
  phase: "coverage",
  synthetic: true,
  real_user_pilot: false,
  superiority_claim: false,
  scope:
    "Same HTTP fixture/contract/authorized operations; generators, case count and shrinking differ. Not a performance ranking.",
  results,
};
fs.writeFileSync(
  path.join(root, "summary.json"),
  JSON.stringify(report, null, 2),
  { flag: "wx", mode: 0o600 },
);
console.log(JSON.stringify({ ...report, private_directory: root }));

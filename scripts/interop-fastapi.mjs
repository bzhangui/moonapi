// Integration-only, independent framework schema export. No installed global
// Python packages, real accounts, existing servers or database files are used.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { StandardEngine } from "../platform/standard.mjs";
import { StandardWorkflow } from "../platform/workflow.mjs";
import { compensationWorkflow } from "../platform/business-templates.mjs";
import { asyncWorkflow } from "../platform/workflow-templates.mjs";

export async function fastapiFixture(python, fault = "healthy") {
  const child = spawn(
    python,
    [
      "-B",
      fileURLToPath(new URL("../examples/fastapi/backend.py", import.meta.url)),
      fault,
    ],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let boot = "",
    resolveReady,
    rejectReady,
    timer;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const stopped = new Promise((resolve) => child.once("close", resolve));
  child.once("error", () => rejectReady(new Error("FASTAPI_SPAWN")));
  child.stderr.on("data", () => {}); // Never expose raw server payloads in errors.
  child.stdout.on("data", (chunk) => {
    boot += chunk.toString();
    if (boot.length > 4096) {
      rejectReady(new Error("FASTAPI_BOOT_BUDGET"));
      child.kill();
      return;
    }
    if (boot.includes("\n"))
      try {
        resolveReady(JSON.parse(boot.split("\n")[0]));
      } catch {
        rejectReady(new Error("FASTAPI_BOOT_ENCODING"));
      }
  });
  child.once("close", () => rejectReady(new Error("FASTAPI_EXITED")));
  timer = setTimeout(
    () => rejectReady(new Error("FASTAPI_BOOT_TIMEOUT")),
    10000,
  );
  const close = async () => {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill();
    let shutdown;
    try {
      await Promise.race([
        stopped,
        new Promise((_, reject) => {
          shutdown = setTimeout(
            () => reject(new Error("FASTAPI_STOP_TIMEOUT")),
            5000,
          );
        }),
      ]);
    } finally {
      clearTimeout(shutdown);
    }
  };
  try {
    const info = await ready;
    clearTimeout(timer);
    if (
      !Number.isInteger(info.port) ||
      info.port < 1 ||
      info.port > 65535 ||
      info.fastapi !== "0.162.0"
    )
      throw new Error("FASTAPI_VERSION_OR_PORT");
    const base = "http://127.0.0.1:" + info.port;
    let source;
    for (let i = 0; i < 100; i++) {
      try {
        const r = await fetch(base + "/openapi.json", {
          signal: AbortSignal.timeout(1000),
          redirect: "error",
        });
        if (r.ok) {
          source = await r.text();
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 25));
    }
    if (!source || Buffer.byteLength(source) > 1048576)
      throw new Error("FASTAPI_SCHEMA_EXPORT");
    return { base, source, close };
  } catch (error) {
    await close();
    throw error;
  }
}
const credentials = { tenant: { value: "tenant-a" } };
export async function runFastapiIntegration(python) {
  const cases = [];
  for (const fault of [
    "healthy",
    "response-type",
    "double-refund",
    "tenant-leak",
    "never-done",
  ]) {
    const f = await fastapiFixture(python, fault);
    const e = await StandardWorkflow.open(f.source, {
      allowWrite: true,
      credentials,
    });
    try {
      const contract = await StandardEngine.open(f.source);
      try {
        const r = await contract.runSelected(f.base, {
          operationIds: ["quote"],
        });
        assert.equal(r.passed, fault !== "response-type");
        cases.push({ case: "quote", fault, expected_observed: true });
      } finally {
        await contract.close();
      }
      if (["healthy", "double-refund"].includes(fault)) {
        const model = compensationWorkflow({
          balance: "balance",
          reserve: "reserve",
          pay: "pay",
          refund: "refund",
          read: "read",
          remove: "remove",
        });
        const r = await e.run(f.base, model, {
          allowCleanup: true,
          shrink: fault === "double-refund",
        });
        assert.equal(r.passed, fault === "healthy");
        assert.equal(r.cleanup_verified, true);
        if (fault === "double-refund") assert.equal(r.shrink_confirmed, true);
        cases.push({
          case: "compensation_and_cleanup",
          fault,
          expected_observed: true,
        });
      }
      if (["healthy", "never-done"].includes(fault)) {
        const r = await e.run(
          f.base,
          asyncWorkflow({
            submit: "submit",
            poll: "poll",
            attempts: 4,
            interval: 1,
          }),
        );
        assert.equal(r.passed, fault === "healthy");
        cases.push({
          case: "eventual_completion",
          fault,
          expected_observed: true,
        });
      }
      if (["healthy", "tenant-leak"].includes(fault)) {
        const request = (operation_id, parameters = [], body) => ({
          operation_id,
          parameters,
          negative: false,
          ...(body ? { body, media: "application/json" } : {}),
        });
        const a = await StandardEngine.open(f.source, {
          allowWrite: true,
          credentials,
        });
        const b = await StandardEngine.open(f.source, {
          credentials: { tenant: { value: "tenant-b" } },
        });
        try {
          const created = await a.execute(
            f.base,
            request("reserve", [], {
              quantity: 1,
              tag: "synthetic-tenant-boundary",
            }),
          );
          const id = created.context.response.body.id;
          const r = await b.execute(
            f.base,
            request("read", [{ in: "path", name: "id", value: id }]),
            { expectedStatuses: [404] },
          );
          assert.equal(r.record.passed, fault === "healthy");
          cases.push({
            case: "tenant_boundary",
            fault,
            expected_observed: true,
          });
        } finally {
          await a.close();
          await b.close();
        }
      }
    } finally {
      await e.close();
      await f.close();
    }
  }
  return {
    passed: true,
    framework: "FastAPI 0.162.0 / Pydantic 2.14.2",
    native_export: true,
    cases,
    real_user_pilot: false,
    production_validation: false,
    cleanup:
      "owned lifecycle resources verified; remaining synthetic state exists only in terminated child memory",
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4 || process.argv[2] !== "--python")
    throw new Error("PASS_PINNED_VENV_PYTHON");
  console.log(JSON.stringify(await runFastapiIntegration(process.argv[3])));
}

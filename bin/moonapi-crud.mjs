import { readTextInput } from "../platform/input.mjs";
import { loadCore, saveReport, VERSION } from "../platform/runner.mjs";
import { OwnedCrudEngine } from "../platform/owned-crud.mjs";
try {
  const args = process.argv.slice(2),
    command = args.shift() || "help";
  if (command === "help") {
    console.log(
      `MoonAPI ${VERSION} owned-resource CRUD\nnode bin/moonapi-crud.mjs plan spec.json --collection /items --field name\nnode bin/moonapi-crud.mjs run spec.json --collection /items --field name --base http://127.0.0.1:PORT --allow-write --allow-cleanup [--shrink-write]\nAuthorized test environments only. Creates and deletes synthetic resources, never a global reset.`,
    );
  } else {
    if (!["plan", "run"].includes(command))
      throw new Error("Unsupported CRUD command");
    const flags = new Set([
      "--allow-write",
      "--allow-cleanup",
      "--allow-remote",
      "--shrink-write",
      "--save-repro",
    ]);
    const values = new Set([
      "--base",
      "--collection",
      "--field",
      "--timeout",
      "--total-timeout",
      "--shrink-budget",
    ]);
    const opts = {},
      paths = [];
    for (let i = 0; i < args.length; i++) {
      const key = args[i];
      if (!key.startsWith("--")) {
        paths.push(key);
        continue;
      }
      if (Object.hasOwn(opts, key)) throw new Error("Duplicate CRUD option");
      if (flags.has(key)) opts[key] = true;
      else if (values.has(key) && args[i + 1] && !args[i + 1].startsWith("--"))
        opts[key] = args[++i];
      else throw new Error("Unknown or incomplete CRUD option");
    }
    if (paths.length !== 1) throw new Error("One API description required");
    const source = readTextInput(paths[0], 524288);
    await loadCore();
    const number = (key, fallback) =>
      opts[key] === undefined ? fallback : Number(opts[key]);
    const engine = new OwnedCrudEngine(source, {
      allowWrite: !!opts["--allow-write"],
      allowRemote: !!opts["--allow-remote"],
      shrinkWrite: !!opts["--shrink-write"],
      timeout: number("--timeout", 1500),
      totalTimeout: number("--total-timeout", 60000),
      shrinkBudget: number("--shrink-budget", 32),
      bearerToken: process.env.MOONAPI_BEARER_TOKEN,
    });
    if (command === "plan") {
      const p = engine.planCrud(opts["--collection"], opts["--field"]);
      console.log(
        JSON.stringify({
          profile: p.profile,
          full_openapi_support: false,
          steps: p.trace.steps.map((s) => ({
            id: s.id,
            operation: s.operationId,
          })),
          inputs_hidden: true,
        }),
      );
    } else {
      if (!opts["--base"]) throw new Error("Explicit base required");
      const report = await engine.runCrud(
        opts["--base"],
        opts["--collection"],
        opts["--field"],
        {
          allowCleanup: !!opts["--allow-cleanup"],
          saveRepro: !!opts["--save-repro"],
        },
      );
      console.log(
        JSON.stringify({
          report: saveReport(report),
          complete: report.complete,
          failed: report.failed,
          cleanup_verified: report.cleanup_verified,
          confirmed: report.property_failure_confirmed,
          minimized_steps: report.minimized_steps,
        }),
      );
      if (!report.complete) process.exitCode = 1;
    }
  }
} catch {
  console.error(
    JSON.stringify({
      ok: false,
      error:
        "CRUD configuration or execution refused; check supported profile and permissions",
    }),
  );
  process.exitCode = 2;
}

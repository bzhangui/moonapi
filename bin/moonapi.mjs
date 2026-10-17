import { readTextInput, readJsonInput } from "../platform/input.mjs";
import { Engine, loadCore, saveReport, VERSION } from "../platform/runner.mjs";
function options(args) {
  const flags = new Set([
    "--allow-write",
    "--allow-remote",
    "--shrink-write",
    "--save-repro",
  ]);
  const out = {},
    positionals = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (flags.has(a)) out[a] = true;
    else if (a.startsWith("--")) {
      if (
        ![
          "--base",
          "--seed",
          "--limit",
          "--timeout",
          "--scenario",
          "--shrink-budget",
        ].includes(a) ||
        i + 1 >= args.length
      )
        throw new Error("Unsupported or missing command-line option");
      out[a] = args[++i];
    } else positionals.push(a);
  }
  return { out, positionals };
}
try {
  const args = process.argv.slice(2),
    command = args.shift() || "help";
  if (command === "help") {
    console.log(
      "MoonAPI " +
        VERSION +
        "\nnode bin/moonapi.mjs plan spec.json\nnode bin/moonapi.mjs run spec.json --base http://127.0.0.1:PORT [--allow-write] [--scenario scenario.json] [--shrink-write]\nOnly test endpoints you own or are authorized to test.",
    );
  } else if (command === "version") console.log("MoonAPI " + VERSION);
  else {
    if (!["plan", "run"].includes(command))
      throw new Error("Unsupported command");
    const { out, positionals } = options(args);
    if (positionals.length !== 1)
      throw new Error("Pass exactly one OpenAPI JSON file");
    const source = readTextInput(positionals[0], 524288);
    await loadCore();
    const engine = new Engine(source, {
      seed: out["--seed"] === undefined ? 42 : Number(out["--seed"]),
      limit: out["--limit"] === undefined ? 64 : Number(out["--limit"]),
      timeout: out["--timeout"] === undefined ? 1500 : Number(out["--timeout"]),
      shrinkBudget:
        out["--shrink-budget"] === undefined
          ? 32
          : Number(out["--shrink-budget"]),
      allowWrite: !!out["--allow-write"],
      allowRemote: !!out["--allow-remote"],
      shrinkWrite: !!out["--shrink-write"],
      bearerToken: process.env.MOONAPI_BEARER_TOKEN,
    });
    if (command === "plan")
      console.log(
        JSON.stringify(
          {
            cases: engine.plan().map((c) => ({
              id: c.id,
              operation: c.operation_id,
              verb: c.verb,
              negative: c.negative,
            })),
            inputs_hidden: true,
            full_openapi_support: false,
          },
          null,
          2,
        ),
      );
    else {
      if (!out["--base"]) throw new Error("--base required");
      let scenario = null;
      if (out["--scenario"]) {
        scenario = readJsonInput(out["--scenario"], 65536);
      }
      const report = await engine.run(out["--base"], {
        scenario,
        saveRepro: !!out["--save-repro"],
      });
      const file = saveReport(report);
      console.log(
        JSON.stringify({
          report: file,
          executed: report.executed,
          failed: report.failed,
          skipped: report.skipped,
          complete: report.complete,
        }),
      );
      if (report.failed || !report.complete || report.executed === 0)
        process.exitCode = 1;
    }
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 2;
}

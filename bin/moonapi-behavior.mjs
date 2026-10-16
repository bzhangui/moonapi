import fs from "node:fs";
import { BehaviorEngine } from "../platform/behavior.mjs";
import { loadCore, saveReport, VERSION } from "../platform/runner.mjs";
function argumentsFor(args) {
  const flags = [
    "--allow-write",
    "--allow-remote",
    "--allow-reset",
    "--shrink-write",
    "--save-repro",
  ];
  const valued = [
    "--model",
    "--base",
    "--reset-operation",
    "--seed",
    "--steps",
    "--timeout",
    "--total-timeout",
    "--shrink-budget",
  ];
  const out = {},
    paths = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      if (Object.hasOwn(out, a)) throw new Error("Duplicate option");
      if (flags.includes(a)) out[a] = true;
      else if (
        valued.includes(a) &&
        i + 1 < args.length &&
        !args[i + 1].startsWith("--")
      )
        out[a] = args[++i];
      else throw new Error("Unknown or incomplete behavior option");
    } else paths.push(a);
  }
  return { out, paths };
}
const read = (file, limit) => {
  try {
    if (!file || !fs.statSync(file).isFile() || fs.statSync(file).size > limit)
      throw new Error();
    return fs.readFileSync(file, "utf8");
  } catch {
    throw new Error("Missing or oversized input file");
  }
};
try {
  const args = process.argv.slice(2),
    command = args.shift() || "help";
  if (command === "help")
    console.log(
      `MoonAPI ${VERSION} stateful behavior\nnode bin/moonapi-behavior.mjs plan spec.json --model behavior.json [--steps 32]\nnode bin/moonapi-behavior.mjs run spec.json --model behavior.json --base http://127.0.0.1:PORT --reset-operation RESET_ID --allow-reset --allow-write [--shrink-write] [--save-repro]\nReset and repeated writes require a disposable, explicitly authorized environment.`,
    );
  else {
    if (!["plan", "run"].includes(command))
      throw new Error("Unsupported behavior command");
    const { out, paths } = argumentsFor(args);
    if (paths.length !== 1) throw new Error("Pass one API description");
    const source = read(paths[0], 524288),
      model = JSON.parse(read(out["--model"], 65536));
    await loadCore();
    const number = (key, fallback) =>
      out[key] === undefined ? fallback : Number(out[key]);
    const runner = new BehaviorEngine(source, {
      allowWrite: !!out["--allow-write"],
      allowRemote: !!out["--allow-remote"],
      shrinkWrite: !!out["--shrink-write"],
      seed: number("--seed", 42),
      timeout: number("--timeout", 1500),
      totalTimeout: number("--total-timeout", 60000),
      shrinkBudget: number("--shrink-budget", 32),
      bearerToken: process.env.MOONAPI_BEARER_TOKEN,
    });
    const steps = number("--steps", 32);
    if (command === "plan") {
      const plan = runner.plan(model, { steps });
      console.log(
        JSON.stringify(
          {
            steps: plan.trace.steps.map((s) => ({
              id: s.id,
              operation: s.operationId,
            })),
            inputs_hidden: true,
            generation_reason: plan.generation_reason,
          },
          null,
          2,
        ),
      );
    } else {
      if (!out["--base"] || !out["--allow-reset"] || !out["--reset-operation"])
        throw new Error(
          "Explicit base, reset operation and --allow-reset required",
        );
      const resetCase = runner.engine.command("scenario", {
        step: { operationId: out["--reset-operation"] },
        bindings: {},
      }).case;
      if (!runner.engine.permitted(resetCase))
        throw new Error("Reset write requires --allow-write");
      const reset = async ({ signal }) => {
        const seen = await runner.engine.observe(
          out["--base"],
          resetCase,
          Date.now() + runner.engine.options.timeout,
          signal,
        );
        return seen.finding.passed;
      };
      const report = await runner.run(out["--base"], model, {
        reset,
        allowReset: true,
        saveRepro: !!out["--save-repro"],
        steps,
      });
      console.log(
        JSON.stringify({
          report: saveReport(report),
          executed: report.executed,
          failed: report.failed,
          complete: report.complete,
          minimized_steps: report.minimized_steps,
          confirmed: report.property_failure_confirmed,
        }),
      );
      if (!report.complete) process.exitCode = 1;
    }
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 2;
}

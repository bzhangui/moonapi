// Owned ephemeral HTTP servers only. Every candidate uses a real reset request.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Engine, loadCore, saveReport } from "../platform/runner.mjs";
import { BehaviorEngine } from "../platform/behavior.mjs";
import { fixture } from "./fixture.mjs";
import { orderSource, orderModel, orderFixture } from "./order-fixture.mjs";
export function behaviorSource() {
  const spec = JSON.parse(
    fs.readFileSync(new URL("./spec.json", import.meta.url), "utf8"),
  );
  spec.paths["/__test/reset"] = {
    post: { operationId: "reset", responses: { 204: {} } },
  };
  return JSON.stringify(spec);
}
export async function resetHook(source, base) {
  const engine = new Engine(source, { allowWrite: true });
  const test = engine.command("scenario", {
    step: { operationId: "reset", status: 204 },
    bindings: {},
  }).case;
  return async ({ signal } = {}) => {
    const seen = await engine.observe(base, test, Date.now() + 2000, signal);
    if (!seen.finding.passed) throw new Error("Isolated fixture reset failed");
    return true;
  };
}
export async function behaviorDemo() {
  await loadCore();
  const source = behaviorSource(),
    model = JSON.parse(
      fs.readFileSync(new URL("./behavior.json", import.meta.url), "utf8"),
    );
  const results = [];
  for (const [name, options] of [
    ["healthy", {}],
    ["ignored_update", { staleUpdate: true }],
    ["ignored_delete", { ignoreDelete: true }],
  ]) {
    const server = await fixture({ enableReset: true, ...options });
    try {
      const runner = new BehaviorEngine(source, {
        allowWrite: true,
        shrinkWrite: true,
        shrinkBudget: 32,
      });
      const report = await runner.run(server.base, model, {
        reset: await resetHook(source, server.base),
        allowReset: true,
        saveRepro: true,
      });
      if (
        (name === "healthy" && !report.complete) ||
        (name !== "healthy" && !report.property_failure_confirmed)
      )
        throw new Error("Behavior fixture expectation failed");
      results.push({
        case: name,
        complete: report.complete,
        fingerprint: report.fingerprint,
        original_steps: report.original_steps,
        minimized_steps: report.minimized_steps,
        reset_count: server.resets,
        report: saveReport(report),
      });
    } finally {
      await server.close();
    }
  }
  for (const bug of [false, true]) {
    const server = await orderFixture({ doubleCredit: bug }),
      source = orderSource();
    try {
      const report = await new BehaviorEngine(source, {
        allowWrite: true,
        shrinkWrite: true,
      }).run(server.base, orderModel(), {
        reset: await resetHook(source, server.base),
        allowReset: true,
        saveRepro: true,
      });
      if (
        (!bug && !report.complete) ||
        (bug && !report.property_failure_confirmed)
      )
        throw new Error("Inventory expectation failed");
      results.push({
        case: bug ? "double_cancel_inventory_credit" : "healthy_order",
        complete: report.complete,
        fingerprint: report.fingerprint,
        original_steps: report.original_steps,
        minimized_steps: report.minimized_steps,
        reset_count: server.resets,
        report: saveReport(report),
      });
    } finally {
      await server.close();
    }
  }
  return { controlled_simulation: true, real_user_pilot: false, results };
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(await behaviorDemo(), null, 2));

import fs from "node:fs";
import assert from "node:assert/strict";
import { loadCore } from "../platform/runner.mjs";
import { OwnedCrudEngine } from "../platform/owned-crud.mjs";
import { fixture } from "./fixture.mjs";
await loadCore();
const source = fs.readFileSync(new URL("./spec.json", import.meta.url), "utf8");
const cases = [];
for (const staleUpdate of [false, true]) {
  const server = await fixture({ staleUpdate });
  server.items.set(90000, { id: 90000, name: "preexisting-sentinel" });
  try {
    const r = await new OwnedCrudEngine(source, {
      allowWrite: true,
      shrinkWrite: true,
    }).runCrud(server.base, "/items", "name", { allowCleanup: true });
    assert.equal(r.cleanup_verified, true);
    assert.equal(r.complete, !staleUpdate);
    assert.equal(server.items.size, 1);
    assert.equal(server.items.get(90000).name, "preexisting-sentinel");
    if (staleUpdate) {
      assert.equal(r.property_failure_confirmed, true);
      assert.equal(r.minimized_steps, 3);
    }
    cases.push({
      case: staleUpdate ? "lost_update" : "healthy",
      complete: r.complete,
      confirmed: r.property_failure_confirmed,
      original_steps: r.original_steps,
      minimized_steps: r.minimized_steps,
      cleanup_verified: r.cleanup_verified,
      sentinel_preserved: true,
    });
  } finally {
    await server.close();
  }
}
console.log(
  JSON.stringify({
    cases,
    no_manual_model: true,
    no_global_reset: true,
    synthetic_data: true,
    real_user_pilot: false,
  }),
);

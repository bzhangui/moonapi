// Pure metadata/constraint bridge: no ambient files, credentials or network.
import { loadCore } from "./runner.mjs";
await loadCore();
export function planningPolicy(action, args) {
  const result = JSON.parse(
    globalThis.__moonapi_core(JSON.stringify({ action, ...args })),
  );
  if (!result.ok) throw new Error("PLANNING_INPUT_OR_BUDGET");
  return result.value;
}

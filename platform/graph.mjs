import { loadCore } from "./runner.mjs";
import { portable, StandardWorkflow } from "./workflow.mjs";
import { cloneExact } from "./standard-value.mjs";
export async function planResourceGraph(graph, { seed = 42, limit = 32 } = {}) {
  await loadCore();
  if (graph?.version !== 2 || !Array.isArray(graph.transitions))
    throw new Error("GRAPH_IR_VERSION");
  const ids = new Set(graph.transitions.map((t) => t.id));
  if (ids.size !== graph.transitions.length) throw new Error("GRAPH_DUPLICATE");
  if (graph.cleanup !== undefined) throw new Error("GRAPH_CLEANUP_UNSUPPORTED");
  for (const t of graph.transitions)
    for (const k of ["requires_state", "set_state"]) {
      const m = t[k] ?? {};
      if (
        !m ||
        Array.isArray(m) ||
        typeof m !== "object" ||
        Object.entries(m).some(
          ([a, b]) =>
            !/^[A-Za-z0-9_.-]{1,96}$/.test(a) ||
            typeof b !== "string" ||
            !/^[A-Za-z0-9_.-]{1,96}$/.test(b),
        )
      )
        throw new Error("GRAPH_STATE");
    }
  const metadata = graph.transitions.map((t) => ({
    id: t.id,
    max_visits: t.max_visits ?? 1,
    requires_state: t.requires_state || {},
    set_state: t.set_state || {},
    needs: [
      ...new Set([
        ...(t.bindings || []).map((b) => b.from),
        ...(t.assertions || []).flatMap((a) =>
          [a.left, a.right]
            .filter((r) => r?.from && r.from !== t.id)
            .map((r) => r.from),
        ),
      ]),
    ],
  }));
  const plan = portable("resource-graph-plan", {
    graph: { initial_state: graph.initial_state || {}, transitions: metadata },
    seed,
    limit,
  });
  const latest = new Map(),
    steps = [];
  const rewrite = (ref) => {
    if (ref?.from) {
      if (!latest.has(ref.from)) throw new Error("GRAPH_REFERENCE");
      ref.from = latest.get(ref.from);
    }
    return ref;
  };
  for (const id of plan.selected) {
    const t = cloneExact(graph.transitions.find((t) => t.id === id)),
      instance = id + "_" + steps.length;
    delete t.max_visits;
    t.id = instance;
    latest.set(id, instance);
    for (const b of t.bindings || []) rewrite(b);
    for (const a of t.assertions || []) {
      rewrite(a.left);
      if (a.right) rewrite(a.right);
    }
    steps.push(t);
  }
  return {
    model: { version: 2, initial_state: graph.initial_state || {}, steps },
    coverage: plan,
    seed,
    limit,
    exhaustive_state_space: false,
  };
}
export async function runGraphCampaign(
  source,
  base,
  graph,
  { seeds = [42], limit = 32, engineOptions = {}, runOptions = {} } = {},
) {
  if (!Array.isArray(seeds) || !seeds.length || seeds.length > 32)
    throw new Error("GRAPH_CAMPAIGN_BUDGET");
  if (!runOptions.allowReset || typeof runOptions.reset !== "function")
    throw new Error("GRAPH_RESET_REQUIRED");
  const covered = new Set(),
    reports = [];
  for (const seed of seeds) {
    const plan = await planResourceGraph(graph, { seed, limit }),
      engine = await StandardWorkflow.open(source, { ...engineOptions, seed });
    try {
      const r = await engine.run(base, plan.model, runOptions);
      reports.push(r);
      if (r.passed) for (const id of plan.coverage.covered) covered.add(id);
    } finally {
      await engine.close();
    }
  }
  return {
    passed:
      reports.every((r) => r.passed) &&
      covered.size === graph.transitions.length,
    covered_transitions: [...covered],
    total_transitions: graph.transitions.length,
    reports,
    exhaustive_state_space: false,
  };
}

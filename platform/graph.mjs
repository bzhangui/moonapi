import { loadCore } from "./runner.mjs";
import { portable, StandardWorkflow } from "./workflow.mjs";
import { cloneExact } from "./standard-value.mjs";
export async function planResourceGraph(
  graph,
  { seed = 42, limit = 32, covered = [] } = {},
) {
  await loadCore();
  if (graph?.version !== 2 || !Array.isArray(graph.transitions))
    throw new Error("GRAPH_IR_VERSION");
  const ids = new Set(graph.transitions.map((t) => t.id));
  if (ids.size !== graph.transitions.length) throw new Error("GRAPH_DUPLICATE");
  if (!Array.isArray(covered) || covered.some((id) => !ids.has(id)))
    throw new Error("GRAPH_COVERAGE");
  if (
    graph.cleanup !== undefined &&
    (!Array.isArray(graph.cleanup) ||
      !graph.cleanup.length ||
      graph.cleanup.length > 64)
  )
    throw new Error("GRAPH_CLEANUP");
  const protection =
    graph.input_protection === undefined ? [] : graph.input_protection;
  if (
    !Array.isArray(protection) ||
    protection.length > 64 ||
    protection.some(
      (l) =>
        !l ||
        Object.keys(l).sort().join(",") !== "step,target" ||
        !ids.has(l.step) ||
        typeof l.target !== "string" ||
        (graph.transitions.find((t) => t.id === l.step).max_visits ?? 1) !== 1,
    )
  )
    throw new Error("GRAPH_INPUT_PROTECTION");
  const cleanupRefs = (graph.cleanup || [])
    .flatMap((s) => [...(s.bindings || []), ...(s.ownership?.bindings || [])])
    .map((b) => b.from);
  if (
    cleanupRefs.some(
      (id) =>
        !ids.has(id) ||
        (graph.transitions.find((t) => t.id === id).max_visits ?? 1) !== 1,
    )
  )
    throw new Error("GRAPH_CLEANUP_AMBIGUOUS");
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
    campaign_visits: covered.includes(t.id) ? 1 : 0,
    requires_state: t.requires_state || {},
    set_state: t.set_state || {},
    needs: [
      ...new Set([
        ...(t.bindings || []).map((b) => b.from),
        ...(t.ownership?.bindings || []).map((b) => b.from),
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
    for (const b of t.ownership?.bindings || []) rewrite(b);
    for (const a of t.assertions || []) {
      rewrite(a.left);
      if (a.right) rewrite(a.right);
    }
    steps.push(t);
  }
  const cleanup = [];
  for (const original of graph.cleanup || []) {
    const s = cloneExact(original),
      refs = [...(s.bindings || []), ...(s.ownership?.bindings || [])];
    // No resource was instantiated when its producer was not selected.
    if (refs.some((b) => !latest.has(b.from))) continue;
    for (const b of refs) rewrite(b);
    cleanup.push(s);
  }
  return {
    model: {
      version: 2,
      initial_state: graph.initial_state || {},
      steps,
      ...(cleanup.length ? { cleanup } : {}),
      ...(protection.length
        ? {
            input_protection: protection
              .filter((l) => latest.has(l.step))
              .map((l) => ({ ...l, step: latest.get(l.step) })),
          }
        : {}),
    },
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
  {
    seeds = [42],
    limit = 32,
    engineOptions = {},
    runOptions = {},
    feedback = false,
  } = {},
) {
  if (!Array.isArray(seeds) || !seeds.length || seeds.length > 32)
    throw new Error("GRAPH_CAMPAIGN_BUDGET");
  if (typeof feedback !== "boolean") throw new Error("GRAPH_FEEDBACK");
  const reset = runOptions.allowReset && typeof runOptions.reset === "function";
  const owned = graph.cleanup?.length > 0 && runOptions.allowCleanup === true;
  if (!reset && !owned) throw new Error("GRAPH_RESET_REQUIRED");
  const covered = new Set(),
    reports = [];
  for (const seed of seeds) {
    const plan = await planResourceGraph(graph, {
        seed,
        limit,
        covered: feedback ? [...covered] : [],
      }),
      engine = await StandardWorkflow.open(source, { ...engineOptions, seed });
    try {
      const r = await engine.run(base, plan.model, runOptions);
      reports.push(r);
      if (r.passed) for (const id of plan.coverage.covered) covered.add(id);
      if (
        r.execution?.unknown_writes > 0 ||
        ["blocked", "budget", "transport"].includes(r.category)
      )
        break;
    } finally {
      await engine.close();
    }
  }
  return {
    passed:
      reports.length === seeds.length &&
      reports.every((r) => r.passed) &&
      covered.size === graph.transitions.length,
    covered_transitions: [...covered],
    total_transitions: graph.transitions.length,
    reports,
    requested_seeds: seeds.length,
    executed_seeds: reports.length,
    truncated: reports.length !== seeds.length,
    exhaustive_state_space: false,
    feedback: feedback
      ? "successful-transition-coverage; bounded; not response-value learning"
      : "off",
  };
}

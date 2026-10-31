// Proposals only. Runtime flags and credentials can never be supplied by a draft.
import { planningPolicy } from "./planning.mjs";
import { isReadOnlyMethod } from "./standard-method.mjs";
export function onboardingGuide(profiles, plan) {
  const edges = [],
    proposals = [],
    seen = new Set();
  const add = (from, to, kind, bindings = []) => {
    const key = JSON.stringify([from, to]);
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ from, to, kind });
    proposals.push({
      from,
      to,
      confidence: kind === "link" ? "declared" : "review_required",
      bindings,
      execution_authorized: false,
    });
  };
  for (const p of profiles)
    for (const r of p.responses)
      for (const target of r.link_targets ?? [])
        add(p.id, target.operation_id, "link", target.bindings);
  for (const p of profiles) {
    if (p.method !== "POST") continue;
    const fields = new Set(
      p.responses.flatMap((r) => r.content.flatMap((c) => c.fields)),
    );
    for (const c of profiles) {
      if (c.id === p.id || !c.path.startsWith(p.path + "/{")) continue;
      const required = c.parameters.filter(
        (v) => v.in === "path" && v.required && fields.has(v.name),
      );
      if (required.length)
        add(
          p.id,
          c.id,
          "shape",
          required.map((v) => ({
            parameter: v.name,
            expression:
              "$response.body#/" +
              v.name.replaceAll("~", "~0").replaceAll("/", "~1"),
          })),
        );
    }
  }
  const catalog = profiles.map(({ id }) => ({ id }));
  const ir = planningPolicy("dependency-ir", { catalog, edges });
  const safe = profiles
    .filter(
      (p) =>
        isReadOnlyMethod(p.method) &&
        !p.authentication_required &&
        !p.request_required &&
        !p.parameters.some((v) => v.required),
    )
    .map((p) => p.id);
  const coverage = profiles.map((p) => {
    const generated = plan.cases.filter((c) => c.operation_id === p.id);
    return {
      operation_id: p.id,
      generated: generated.length,
      positive: generated.filter((c) => !c.negative).length,
      negative: generated.filter((c) => c.negative).length,
      declared_response_branches: p.responses.length,
      observed_response_branches: 0,
      authentication_required: p.authentication_required,
      generation_blocked: plan.blockers.some((b) => b.operation_id === p.id),
      execution_observed: false,
    };
  });
  return {
    format: 1,
    draft: true,
    dependency_ir: ir,
    proposals,
    coverage,
    presets: {
      readonly: { mode: "contract", operationIds: safe },
      isolated_write: {
        mode: "owned",
        requires: [
          "disposable_environment",
          "explicit_write",
          "ownership_verified_cleanup",
          "reviewed_resource_mapping",
        ],
      },
      workflow: {
        mode: "workflow",
        requires: [
          "reviewed_bindings",
          "business_assertions",
          "isolation_and_cleanup",
        ],
      },
    },
    gates: {
      authentication: profiles
        .filter((p) => p.authentication_required)
        .map((p) => p.id),
      side_effect_review: profiles
        .filter((p) => !isReadOnlyMethod(p.method))
        .map((p) => p.id),
      explicit_permissions_required: true,
    },
    exhaustive_business_coverage: false,
    real_user_pilot: false,
  };
}

import { cloneExact } from "./standard-value.mjs";
import { workflowModel } from "./workflow.mjs";
// Explicit, semantics-preserving v1 -> v2 upgrade. New IR versions never fall
// through or silently discard fields. Validation performs no HTTP/reset.
export function migrateWorkflow(input, description, targetVersion = 2) {
  if (targetVersion !== 2 || ![1, 2].includes(input?.version))
    throw new Error("WORKFLOW_MIGRATION_VERSION");
  workflowModel(input, description);
  const model = cloneExact(input),
    from = model.version;
  model.version = 2;
  model.initial_state ??= {};
  workflowModel(model, description);
  return { from, to: 2, model, automatic_execution: false, dropped_fields: [] };
}

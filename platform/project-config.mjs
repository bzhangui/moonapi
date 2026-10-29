import { StandardEngine } from "./standard.mjs";
import { StandardWorkflow } from "./workflow.mjs";
import { ownedResourceWorkflow } from "./workflow-templates.mjs";
import { parseExact } from "./standard-value.mjs";
import { Engine } from "./runner.mjs";
import { isReadOnlyMethod } from "./standard-method.mjs";
async function readonlyDefaults(engine) {
  const profiles = await engine.profiles();
  return profiles
    .filter(
      (o) =>
        isReadOnlyMethod(o.method) && !o.parameters.some((p) => p.required),
    )
    .map((o) => o.id);
}
export async function inspectProject(source, options = {}) {
  const engine = await StandardEngine.open(source, options);
  try {
    const plan = await engine.plan();
    return {
      operations: engine.description.operations.map((o) => ({
        id: o.id,
        method: o.method,
        route: o.path,
      })),
      generated_cases: plan.cases.length,
      blockers: plan.blockers,
      readonly_default: await readonlyDefaults(engine),
    };
  } finally {
    await engine.close();
  }
}
export async function runProject(
  input,
  {
    allowWrite = false,
    allowRemote = false,
    allowCleanup = false,
    credentialProvider,
    journalDirectory,
    journalOptions,
    intentStore,
    onEngine = () => {},
  } = {},
) {
  if (
    !input ||
    !["contract", "owned", "workflow"].includes(input.mode) ||
    typeof input.source !== "string"
  )
    throw new Error("PROJECT_INPUT");
  new Engine("{}", { allowRemote }).base(input.base);
  const options = {
    allowWrite,
    allowRemote,
    credentialProvider,
    intentStore,
    documents: input.documents ?? {},
    seed: input.seed ?? 42,
    limit: input.limit ?? 64,
    timeout: input.timeout ?? 2000,
    totalTimeout: input.totalTimeout ?? 60000,
  };
  const engine = await (
    input.mode === "contract" ? StandardEngine : StandardWorkflow
  ).open(input.source, options);
  try {
    onEngine(engine);
    if (input.mode === "contract") {
      const operationIds =
        input.operationIds ?? (await readonlyDefaults(engine));
      return await engine.runSelected(input.base, {
        operationIds,
        journalDirectory,
        journalOptions,
      });
    }
    const model =
      input.mode === "owned"
        ? ownedResourceWorkflow(input.resource ?? {})
        : typeof input.model === "string"
          ? parseExact(input.model)
          : input.model;
    // A model cannot grant reset, remote/write or arbitrary JavaScript execution.
    return await engine.run(input.base, model, {
      allowCleanup,
      journalDirectory,
      journalOptions,
      totalTimeout: options.totalTimeout,
    });
  } finally {
    await engine.close();
  }
}

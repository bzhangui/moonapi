import {
  feedbackFixture,
  feedbackSource,
  feedbackModel,
} from "./feedback-fixture.mjs";
import { ResponseCorpus } from "../platform/response-corpus.mjs";
import { documentDigest, publicReport } from "../platform/ci-tools.mjs";
import { intentEnvironmentBinding } from "../platform/execution-intent.mjs";
import { StandardWorkflow } from "../platform/workflow.mjs";
for (const fault of ["", "unicode"]) {
  const f = await feedbackFixture({ fault }),
    source = feedbackSource(),
    corpus = new ResponseCorpus({
      documentBinding: documentDigest(source),
      environmentBinding: intentEnvironmentBinding(f.base),
      sources: [
        {
          id: "codes",
          operation: "hints",
          pointer: "/values",
          explode: true,
          consumers: ["quote"],
        },
      ],
    }),
    engine = await StandardWorkflow.open(source, { allowWrite: true });
  try {
    const report = await engine.run(f.base, feedbackModel(), {
      feedbackCorpus: corpus,
      allowReset: true,
      reset: f.reset,
      shrink: true,
    });
    if ((!fault && !report.passed) || (fault && !report.shrink_confirmed))
      throw new Error("FEEDBACK_DEMO_FAILED");
    console.log(
      JSON.stringify({
        synthetic: true,
        real_user_validation: false,
        mutant: !!fault,
        feedback: corpus.summary(),
        ...publicReport(report),
      }),
    );
  } finally {
    await engine.close();
    await f.close();
  }
}

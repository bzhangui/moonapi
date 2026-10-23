import fs from "node:fs";
import assert from "node:assert/strict";
import { StandardEngine } from "../platform/standard.mjs";
import { startStandardFixture } from "./standard-fixture.mjs";

const source = fs.readFileSync(
  new URL("./standard-spec.json", import.meta.url),
  "utf8",
);
for (const defect of [false, true]) {
  const fixture = await startStandardFixture({ defect });
  let engine;
  try {
    engine = await StandardEngine.open(source, { allowWrite: true });
    const result = await engine.run(fixture.base);
    assert.equal(
      result.passed,
      !defect,
      "Healthy control and injected fault must differ",
    );
    assert.deepEqual(result.blockers, []);
    assert.equal(result.executed, result.planned);
    console.log(
      JSON.stringify({
        synthetic: true,
        defect,
        planned: result.planned,
        executed: result.executed,
        failures: result.failed,
        expected_outcome_confirmed: true,
        full_openapi_support: false,
      }),
    );
  } finally {
    await engine?.close();
    await fixture.close();
  }
}

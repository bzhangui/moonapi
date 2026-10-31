import test from "node:test";
import assert from "node:assert/strict";
import { compensationWorkflow } from "../platform/business-templates.mjs";
import { inputProtection } from "../platform/input-protection.mjs";
const mapping = {
  balance: "balance",
  reserve: "reserve",
  pay: "pay",
  refund: "refund",
  read: "read",
  remove: "remove",
};
test("compensation template declares business invariants and locks the cleanup ownership source", () => {
  const model = compensationWorkflow(mapping);
  assert.equal(model.version, 2);
  assert.equal(model.steps.length, 6);
  assert.deepEqual(
    model.steps.at(-1).assertions.map((s) => s.id),
    ["balance_conserved", "stock_conserved"],
  );
  assert.equal(inputProtection(model).complete, true);
  assert.equal(
    model.cleanup[0].ownership.allowed[0],
    model.steps[1].request.body.tag,
  );
  const another = compensationWorkflow(mapping);
  assert.notEqual(
    another.steps[1].request.body.tag,
    model.steps[1].request.body.tag,
  );
});
test("business template cannot invent missing operation mappings or accept fractional quantities", () => {
  for (const options of [
    { ...mapping, remove: undefined },
    { ...mapping, quantity: 0 },
    { ...mapping, quantity: 0.5 },
    { ...mapping, quantity: 1000001 },
  ])
    assert.throws(() => compensationWorkflow(options));
});

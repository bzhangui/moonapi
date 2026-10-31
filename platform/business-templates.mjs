import { randomBytes } from "node:crypto";
// Explicit operations and business invariants, not inferred business meaning.
// Caller must provide a disposable environment and write/cleanup authorization.
export function compensationWorkflow({
  balance,
  reserve,
  pay,
  refund,
  read,
  remove,
  quantity = 1,
}) {
  if (
    ![balance, reserve, pay, refund, read, remove].every(
      (s) => typeof s === "string" && s.length > 0,
    ) ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > 1000000
  )
    throw new Error("BUSINESS_TEMPLATE_INPUT");
  const marker = "moonapi_" + randomBytes(12).toString("hex");
  const req = (operation_id, body) => ({
    operation_id,
    parameters: [],
    negative: false,
    ...(body ? { media: "application/json", body } : {}),
  });
  const bindings = [
    {
      from: "reserve",
      expression: "$response.body#/id",
      target: "$request.path.id",
    },
  ];
  const order = (id, operation, requires, effects) => ({
    id,
    requires,
    effects,
    request: req(operation),
    bindings: structuredClone(bindings),
  });
  const same = (id, pointer) => ({
    id,
    kind: "equal",
    left: { from: "after", expression: "$response.body#" + pointer },
    right: { from: "before", expression: "$response.body#" + pointer },
  });
  return {
    version: 2,
    initial_state: {},
    input_protection: [{ step: "reserve", target: "$request.body#/tag" }],
    steps: [
      { id: "before", effects: ["baseline"], request: req(balance) },
      {
        id: "reserve",
        requires: ["baseline"],
        effects: ["reserved"],
        request: req(reserve, { quantity, tag: marker }),
      },
      order("pay", pay, ["reserved"], ["paid"]),
      order("refund", refund, ["paid"], ["refunded"]),
      order("duplicate_refund", refund, ["refunded"], ["duplicate_checked"]),
      {
        id: "after",
        requires: ["duplicate_checked"],
        request: req(balance),
        assertions: [
          same("balance_conserved", "/balance"),
          same("stock_conserved", "/available"),
        ],
      },
    ],
    cleanup: [
      {
        id: "owned_cleanup",
        request: req(remove),
        bindings: structuredClone(bindings),
        ownership: {
          request: req(read),
          bindings: structuredClone(bindings),
          pointer: "/tag",
          allowed: [marker],
        },
      },
    ],
  };
}

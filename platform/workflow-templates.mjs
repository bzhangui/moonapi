import { cloneExact } from "./standard-value.mjs";
const req = (operation_id, body) => ({
  operation_id,
  parameters: [],
  negative: false,
  ...(body === undefined ? {} : { media: "application/json", body }),
});
const from = (step, expression) => ({ from: step, expression });
const val = (value) => ({ value });
const bind = (step, expression, target) => ({ from: step, expression, target });
// Templates generate explicit models only. The caller selects operations and
// owns a disposable namespace/reset. No guessed DELETE or ID is ever executed.
export function resourceWorkflow({
  create,
  read,
  update,
  remove,
  idParameter = "id",
  idPointer = "/id",
  field = "name",
  initial = "owned",
  changed = "changed",
  createBody = {},
  updateBody = {},
}) {
  const ptr = "/" + field.replace(/~/g, "~0").replace(/\//g, "~1");
  const binding = () => [
    bind(
      "create",
      "$response.body#" + idPointer,
      "$request.path." + idParameter,
    ),
  ];
  const readStep = (id, expected) => ({
    id,
    requires: [id === "verify" ? "updated" : "created"],
    request: req(read),
    bindings: binding(),
    assertions: [
      {
        id: "persistent",
        kind: "equal",
        left: from(id, "$response.body#" + ptr),
        right: val(expected),
      },
    ],
  });
  return {
    version: 1,
    steps: [
      {
        id: "create",
        effects: ["created"],
        request: req(create, { ...cloneExact(createBody), [field]: initial }),
      },
      readStep("read", initial),
      {
        id: "update",
        requires: ["created"],
        effects: ["updated"],
        request: req(update, { ...cloneExact(updateBody), [field]: changed }),
        bindings: binding(),
      },
      readStep("verify", changed),
      ...(remove
        ? [
            {
              id: "delete",
              requires: ["updated"],
              effects: ["deleted"],
              request: req(remove),
              bindings: binding(),
            },
            {
              id: "verify_deleted",
              requires: ["deleted"],
              request: req(read),
              bindings: binding(),
              expect: [404, 410],
            },
          ]
        : []),
    ],
  };
}
export function idempotencyWorkflow({
  operation,
  keyParameter = "Idempotency-Key",
  key,
  body,
  read,
  bindings = [],
  resultPointer = "/id",
}) {
  if (typeof key !== "string" || !key)
    throw new Error("WORKFLOW_IDEMPOTENCY_KEY");
  const request = {
    ...req(operation, body),
    parameters: [{ in: "header", name: keyParameter, value: key }],
  };
  return {
    version: 1,
    steps: [
      { id: "first", request: cloneExact(request) },
      {
        id: "duplicate",
        request: cloneExact(request),
        assertions: [
          {
            id: "stable_result",
            kind: "equal",
            left: from("duplicate", "$response.body#" + resultPointer),
            right: from("first", "$response.body#" + resultPointer),
          },
        ],
      },
      ...(read
        ? [{ id: "verify", request: req(read), bindings, assertions: [] }]
        : []),
    ],
  };
}
export function asyncWorkflow({
  submit,
  body,
  poll,
  idParameter = "id",
  idPointer = "/id",
  statusPointer = "/state",
  done = "done",
  attempts = 5,
  interval = 20,
}) {
  return {
    version: 1,
    steps: [
      { id: "submit", request: req(submit, body) },
      {
        id: "poll",
        request: req(poll),
        bindings: [
          bind(
            "submit",
            "$response.body#" + idPointer,
            "$request.path." + idParameter,
          ),
        ],
        poll: { attempts, interval },
        assertions: [
          {
            id: "completed",
            kind: "equal",
            left: from("poll", "$response.body#" + statusPointer),
            right: val(done),
          },
        ],
      },
    ],
  };
}
export async function discoverDependencies(engine) {
  const profiles = await engine.profiles(),
    suggestions = [];
  for (const producer of profiles)
    for (const response of producer.responses) {
      for (const name of response.links)
        suggestions.push({
          producer: producer.id,
          response: response.status,
          kind: "explicit-link",
          name,
          confidence: "explicit",
          automatic_write: false,
        });
      if (response.location)
        suggestions.push({
          producer: producer.id,
          response: response.status,
          kind: "location",
          confidence: "candidate",
          requires_origin_and_route_confirmation: true,
          automatic_write: false,
        });
      for (const consumer of profiles)
        if (consumer.id !== producer.id)
          for (const p of consumer.parameters) {
            if (!["path", "query"].includes(p.in)) continue;
            const matches = response.content.filter((c) =>
              c.fields.includes(p.name),
            );
            if (matches.length)
              suggestions.push({
                producer: producer.id,
                consumer: consumer.id,
                parameter: p.name,
                kind: "schema-field",
                confidence: "candidate",
                ambiguous:
                  profiles.filter((o) =>
                    o.responses.some((r) =>
                      r.content.some((c) => c.fields.includes(p.name)),
                    ),
                  ).length !== 1,
                automatic_write: false,
              });
          }
    }
  return {
    format: 1,
    profiles,
    suggestions,
    policy:
      "Draft only; confirm operation, typed binding, origin, and disposable ownership before execution.",
  };
}
// Reserve -> cancel -> duplicate cancel must conserve the pre-reservation stock.
export function inventoryWorkflow({
  inventory,
  reserve,
  cancel,
  quantity = 1,
  idParameter = "id",
  idPointer = "/id",
  stockPointer = "/available",
}) {
  const binding = () => [
    bind(
      "reserve",
      "$response.body#" + idPointer,
      "$request.path." + idParameter,
    ),
  ];
  return {
    version: 1,
    steps: [
      { id: "before", effects: ["baseline"], request: req(inventory) },
      {
        id: "reserve",
        requires: ["baseline"],
        effects: ["reserved"],
        request: req(reserve, { quantity }),
      },
      {
        id: "cancel_once",
        requires: ["reserved"],
        effects: ["cancelled"],
        request: req(cancel),
        bindings: binding(),
      },
      {
        id: "cancel_twice",
        requires: ["cancelled"],
        effects: ["duplicate"],
        request: req(cancel),
        bindings: binding(),
      },
      {
        id: "after",
        requires: ["duplicate"],
        request: req(inventory),
        assertions: [
          {
            id: "stock_conserved",
            kind: "equal",
            left: from("after", "$response.body#" + stockPointer),
            right: from("before", "$response.body#" + stockPointer),
          },
        ],
      },
    ],
  };
}

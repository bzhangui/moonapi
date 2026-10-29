// Required by validate after all-target builds. No credentials or user data.
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { loadCore } from "../platform/runner.mjs";
import { moon, moonEnv } from "./build.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
await loadCore();
const vectors = [
  { action: "feedback-choice", counts: [1, 0, 2], seed: 42 },
  {
    action: "resource-history",
    model: "reservation",
    initial: 1,
    capacity: 1,
    history: [
      {
        kind: "reserve",
        amount: 1,
        observed: 0,
        success: true,
        start: 1,
        end: 3,
      },
      {
        kind: "reserve",
        amount: 1,
        observed: 0,
        success: true,
        start: 2,
        end: 4,
      },
    ],
  },
  {
    action: "resource-history",
    model: "counter",
    initial: 0,
    capacity: 10,
    history: [
      { kind: "add", amount: 2, observed: 2, success: true, start: 1, end: 2 },
    ],
  },
  { action: "execution-transition", from: "sent", to: "unknown" },
  { action: "execution-transition", from: "unknown", to: "dispatching" },
  {
    action: "exact-decimal-relation",
    left: { coefficient: "9223372036854775807", exponent: 0 },
    right: { coefficient: "9223372036854775806", exponent: 0 },
    kind: "gt",
  },
  {
    action: "exact-decimal-sum",
    values: [
      { coefficient: "1", exponent: -21 },
      { coefficient: "2", exponent: -21 },
    ],
    expected: { coefficient: "3", exponent: -21 },
  },
  {
    action: "resource-state-check",
    initial: { order: "new" },
    steps: [{ requires_state: { order: "new" }, set_state: { order: "paid" } }],
  },
  {
    action: "resource-graph-plan",
    graph: {
      initial_state: { item: "absent" },
      transitions: [
        {
          id: "create",
          requires_state: { item: "absent" },
          set_state: { item: "present" },
          max_visits: 1,
          needs: [],
        },
      ],
    },
    seed: 73,
    limit: 8,
  },
  {
    action: "register-history",
    initial: 0,
    history: [
      {
        kind: "cas",
        value: 1,
        expected: 0,
        observed: 1,
        success: true,
        start: 1,
        end: 3,
      },
      {
        kind: "cas",
        value: 1,
        expected: 0,
        observed: 1,
        success: true,
        start: 2,
        end: 4,
      },
    ],
  },
];
for (const vector of vectors) {
  const input = JSON.stringify(vector),
    js = JSON.parse(globalThis.__moonapi_core(input)),
    result = spawnSync(
      moon,
      [
        "run",
        "cmd/policy",
        "--target",
        "native",
        "--release",
        "--frozen",
        "--",
        input,
      ],
      {
        cwd: root,
        env: moonEnv,
        encoding: "utf8",
        timeout: 15000,
        windowsHide: true,
        maxBuffer: 1048576,
      },
    );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), js);
}
console.log(
  JSON.stringify({
    native_policy_parity: true,
    vectors: vectors.length,
    http_runtime_still_node: true,
  }),
);

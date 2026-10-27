///|
test "resource states are replaceable and stale preconditions cannot pass" {
  let initial : Json = { "order": "new" }
  let steps : Json = [
    {
      "requires_state": { "order": "new" },
      "set_state": { "order": "cancelled" },
    },
  ]
  assert_eq(
    field(field(resource_state_check(initial, steps), "state"), "order"),
    Json("cancelled"),
  )
  let rejected = try {
    ignore(resource_state_check({ "order": "cancelled" }, steps))
    false
  } catch {
    _ => true
  }
  assert_eq(rejected, true)
}

///|
test "unreachable malformed graph metadata and excessive visits cannot hide from validation" {
  let invalid : Array[Json] = [
    [{ "id": "x", "requires_state": 4 }],
    [{ "id": "x", "max_visits": 0 }],
    [{ "id": "x", "needs": ["missing"] }],
    [{ "id": "x" }, { "id": "x" }],
  ]
  for transitions in invalid {
    let rejected = try {
      ignore(
        resource_graph_plan(
          { "initial_state": {}, "transitions": transitions },
          42,
          8,
        ),
      )
      false
    } catch {
      _ => true
    }
    assert_eq(rejected, true)
  }
  let blocked : Json = {
    "initial_state": { "x": "absent" },
    "transitions": [{ "id": "read", "requires_state": { "x": "present" } }],
  }
  assert_eq(
    field(resource_graph_plan(blocked, 42, 8), "all_transitions_covered"),
    Json(false),
  )
}

///|
test "resource graph schedules enabled transitions fairly and deterministically" {
  let graph : Json = {
    "initial_state": { "resource": "empty" },
    "transitions": [
      {
        "id": "create",
        "set_state": { "resource": "ready" },
        "requires_state": { "resource": "empty" },
      },
      {
        "id": "read",
        "needs": ["create"],
        "requires_state": { "resource": "ready" },
        "max_visits": 2,
      },
    ],
  }
  assert_eq(
    resource_graph_plan(graph, 73, 8),
    resource_graph_plan(graph, 73, 8),
  )
  assert_eq(
    field(resource_graph_plan(graph, 73, 8), "all_transitions_covered"),
    Json(true),
  )
  for kind in ["gt", "gte", "lt", "lte", "sum", "unique"] {
    assert_eq(field(workflow_assert(kind, true), "passed"), Json(true))
  }
}

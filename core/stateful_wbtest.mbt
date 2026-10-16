///|
fn state_trace() -> Json {
  {
    "format": 1,
    "name": "read_after_write",
    "initial": { "phase": "empty" },
    "steps": [
      {
        "id": "create",
        "operationId": "create",
        "requires": { "phase": "empty" },
        "set": { "phase": "created" },
        "capture": { "item_id": "/id" },
      },
      { "id": "noise", "operationId": "health" },
      {
        "id": "update",
        "operationId": "update",
        "requires": { "phase": "created" },
        "set": { "phase": "updated" },
        "parameters": { "id": { "$from": "item_id" } },
        "body": { "name": "second" },
      },
      {
        "id": "readback",
        "operationId": "read",
        "requires": { "phase": "updated" },
        "parameters": { "id": { "$from": "item_id" } },
        "assert": [
          {
            "id": "persisted_name",
            "pointer": "/name",
            "op": "eq",
            "expected": "second",
          },
        ],
      },
    ],
  }
}

///|
test "state model exposes contract-valid read-after-write bugs" {
  let trace = state_trace()
  validate_sequence(trace)
  let step = array(field(trace, "steps"))[3]
  assert_true(model_assertions(step, { "name": "second" }, {}).passed)
  let failure = model_assertions(step, { "name": "first" }, {})
  assert_true(!failure.passed)
  assert_eq(failure.fingerprint, "readback:behavior_assertion:persisted_name")
}

///|
test "sequence reduction removes noise but preserves creator and model transition" {
  let candidates = sequence_candidates(state_trace())
  assert_true(!candidates.is_empty())
  assert_true(candidates.any(c => array(field(c, "steps")).length() == 3))
  for c in candidates {
    validate_sequence(c)
    let steps = array(field(c, "steps"))
    if steps.any(s => field(s, "id") == "readback") {
      assert_true(steps.any(s => field(s, "id") == "create"))
      assert_true(steps.any(s => field(s, "id") == "update"))
    }
  }
}

///|
test "forward references and invalid effect states are rejected" {
  let invalid : Array[Json] = [
    { "id": "missing", "operationId": "read", "body": { "$from": "unknown" } },
    {
      "id": "missing",
      "operationId": "read",
      "requires": { "phase": "updated" },
    },
    { "id": "missing", "operationId": "read", "set": { "unknown": 1 } },
    { "id": "missing", "operationId": "read", "capture": { "phase": "/name" } },
    {
      "id": "missing",
      "operationId": "read",
      "assert": [{ "id": "a", "pointer": "/~2", "op": "exists" }],
    },
  ]
  for step in invalid {
    let model : Json = {
      "format": 1,
      "name": "bad",
      "initial": { "phase": "empty" },
      "steps": [step],
    }
    assert_true(
      try {
        validate_sequence(model)
        false
      } catch {
        _ => true
      },
    )
  }
}

///|
test "missing differs from null and comparison operators are explicit" {
  let step : Json = {
    "id": "checks",
    "assert": [
      { "id": "null_exists", "pointer": "/null", "op": "exists" },
      { "id": "missing", "pointer": "/missing", "op": "absent" },
      {
        "id": "unicode_length",
        "pointer": "/text",
        "op": "length",
        "expected": 1,
      },
      { "id": "lower", "pointer": "/n", "op": "gte", "expected": 2 },
      { "id": "upper", "pointer": "/n", "op": "lte", "expected": 4 },
      { "id": "different", "pointer": "/n", "op": "ne", "expected": 9 },
      {
        "id": "captured",
        "pointer": "/n",
        "op": "eq",
        "expected": { "$from": "expected_n" },
      },
    ],
  }
  assert_true(
    model_assertions(step, { "null": null, "text": "😀", "n": 3 }, {
      "expected_n": 3,
    }).passed,
  )
  assert_true(
    !model_assertions(step, { "text": "ab", "n": 1 }, { "expected_n": 3 }).passed,
  )
}

///|
test "state generation is deterministic bounded and produces valid traces" {
  let trace = state_trace()
  let model : Json = {
    "format": 1,
    "name": "generated",
    "initial": field(trace, "initial"),
    "transitions": field(trace, "steps"),
  }
  let a = generate_sequence(model, 42, 12)
  assert_true(a == generate_sequence(model, 42, 12))
  validate_sequence(field(a, "trace"))
  assert_true(array(field(field(a, "trace"), "steps")).length() <= 12)
  assert_true(
    try {
      ignore(generate_sequence(model, -1, 12))
      false
    } catch {
      _ => true
    },
  )
}

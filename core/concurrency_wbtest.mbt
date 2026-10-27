///|
test "register histories reject two successful CAS claims and malformed observations" {
  let bad : Json = [
    {
      "kind": "cas",
      "expected": 0,
      "value": 1,
      "observed": 1,
      "success": true,
      "start": 1,
      "end": 3,
    },
    {
      "kind": "cas",
      "expected": 0,
      "value": 1,
      "observed": 1,
      "success": true,
      "start": 2,
      "end": 4,
    },
  ]
  assert_eq(field(register_history(0, bad), "linearizable"), Json(false))
  let healthy : Json = [
    {
      "kind": "cas",
      "expected": 0,
      "value": 1,
      "observed": 1,
      "success": true,
      "start": 1,
      "end": 3,
    },
    {
      "kind": "cas",
      "expected": 0,
      "value": 1,
      "observed": 1,
      "success": false,
      "start": 2,
      "end": 4,
    },
  ]
  assert_eq(field(register_history(0, healthy), "linearizable"), Json(true))
  let rejected = try {
    ignore(register_history(0, [{ "kind": "read", "start": 1, "end": 2 }]))
    false
  } catch {
    _ => true
  }
  assert_eq(rejected, true)
}

///|
test "register histories honor real time ordering read/write success and required CAS inputs" {
  let history : Json = [
    {
      "kind": "write",
      "value": 7,
      "observed": 7,
      "success": true,
      "start": 1,
      "end": 2,
    },
    { "kind": "read", "observed": 7, "success": true, "start": 2, "end": 3 },
  ]
  assert_eq(field(register_history(0, history), "linearizable"), Json(true))
  let stale : Json = [
    {
      "kind": "write",
      "value": 7,
      "observed": 7,
      "success": true,
      "start": 1,
      "end": 2,
    },
    { "kind": "read", "observed": 0, "success": true, "start": 2, "end": 3 },
  ]
  assert_eq(field(register_history(0, stale), "linearizable"), Json(false))
  let invalid : Array[Json] = [
    [],
    [{ "kind": "cas", "observed": 1, "success": true, "start": 1, "end": 2 }],
    [{ "kind": "read", "observed": 0, "success": true, "start": 2, "end": 1 }],
  ]
  for history in invalid {
    let rejected = try {
      ignore(register_history(0, history))
      false
    } catch {
      _ => true
    }
    assert_eq(rejected, true)
  }
}

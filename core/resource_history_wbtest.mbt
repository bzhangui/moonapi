///|
test "reservation history detects overselling with an explicit capacity" {
  let bad : Json = [
    {
      "kind": "reserve",
      "amount": 1,
      "observed": 0,
      "success": true,
      "start": 1,
      "end": 3,
    },
    {
      "kind": "reserve",
      "amount": 1,
      "observed": 0,
      "success": true,
      "start": 2,
      "end": 4,
    },
  ]
  assert_eq(
    field(resource_history("reservation", 1, 1, bad), "linearizable"),
    Json(false),
  )
  let good : Json = [
    {
      "kind": "reserve",
      "amount": 1,
      "observed": 0,
      "success": true,
      "start": 1,
      "end": 3,
    },
    {
      "kind": "reserve",
      "amount": 1,
      "observed": 0,
      "success": false,
      "start": 2,
      "end": 4,
    },
  ]
  assert_eq(
    field(resource_history("reservation", 1, 1, good), "linearizable"),
    Json(true),
  )
}

///|
test "bounded counter honors increments, capacity refusal and real-time reads" {
  let good : Json = [
    {
      "kind": "add",
      "amount": 2,
      "observed": 2,
      "success": true,
      "start": 1,
      "end": 2,
    },
    {
      "kind": "add",
      "amount": 1,
      "observed": 2,
      "success": false,
      "start": 3,
      "end": 4,
    },
    {
      "kind": "read",
      "amount": 0,
      "observed": 2,
      "success": true,
      "start": 5,
      "end": 6,
    },
  ]
  assert_eq(
    field(resource_history("counter", 0, 2, good), "linearizable"),
    Json(true),
  )
  let rejected = try {
    ignore(
      resource_history("reservation", 1, 1, [
        {
          "kind": "reserve",
          "amount": -1,
          "observed": 2,
          "success": true,
          "start": 1,
          "end": 2,
        },
      ]),
    )
    false
  } catch {
    _ => true
  }
  assert_eq(rejected, true)
}

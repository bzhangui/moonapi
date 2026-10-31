///|
test "portable precise lattice candidates include signed bounds and fractions" {
  let result = numeric_candidate({
    "lower": { "coefficient": "9223372036854775807", "exponent": 0 },
    "step": { "coefficient": "1", "exponent": 0 },
    "exclusive_lower": true,
    "offset": 0,
    "integer": true,
  })
  assert_eq(field(result, "coefficient"), Json("9223372036854775808"))
  let integer = numeric_candidate({
    "upper": { "coefficient": "-21", "exponent": -1 },
    "step": { "coefficient": "25", "exponent": -2 },
    "offset": 0,
    "integer": true,
  })
  assert_eq(field(integer, "coefficient"), Json("-30"))
  assert_eq(field(integer, "exponent"), Json(-1))
}

///|
test "portable dependency layers retain cycles and reject unknown nodes" {
  let catalog : Json = [{ "id": "create" }, { "id": "read" }]
  let result = dependency_ir(catalog, [
    { "from": "create", "to": "read", "kind": "link" },
  ])
  assert_eq(field(result, "layers"), [["create"], ["read"]])
  assert_eq(field(result, "execution_authorized"), Json(false))
  let rejected = try {
    ignore(
      dependency_ir(catalog, [{ "from": "other", "to": "read", "kind": "link" }]),
    )
    false
  } catch {
    _ => true
  }
  assert_eq(rejected, true)
}

///|
test "coverage priorities are bounded deterministic and fair" {
  let catalog : Json = [
    { "id": "a", "count": 3, "visits": 99 },
    { "id": "b", "count": 3, "visits": 0 },
  ]
  let result = coverage_schedule(catalog, 0, 2)
  assert_eq(field(result, "selected"), [
    { "operation_id": "b", "variant": 0 },
    { "operation_id": "a", "variant": 0 },
  ])
  assert_eq(field(result, "truncated"), Json(true))
  assert_eq(field(coverage_schedule([], 0, 2), "available"), Json(0))
}

///|
test "dependency cycles and downstream nodes remain unresolved with duplicated edges deduplicated" {
  let catalog : Json = [{ "id": "a" }, { "id": "b" }, { "id": "c" }]
  let result = dependency_ir(catalog, [
    { "from": "a", "to": "b", "kind": "link" },
    { "from": "a", "to": "b", "kind": "shape" },
    { "from": "b", "to": "a", "kind": "link" },
    { "from": "b", "to": "c", "kind": "link" },
  ])
  assert_eq(field(result, "acyclic"), Json(false))
  assert_eq(field(result, "unresolved"), ["a", "b", "c"])
}

///|
test "portable planning rejects malformed counts steps and Boolean options" {
  let inputs : Array[Json] = [
    { "step": { "coefficient": "0", "exponent": 0 }, "offset": 0 },
    { "step": { "coefficient": "1", "exponent": 0 }, "offset": 32 },
    {
      "step": { "coefficient": "1", "exponent": 0 },
      "offset": 0,
      "integer": "true",
    },
  ]
  for input in inputs {
    let rejected = try {
      ignore(numeric_candidate(input))
      false
    } catch {
      _ => true
    }
    assert_eq(rejected, true)
  }
  let rejected = try {
    ignore(coverage_schedule([{ "id": "a", "count": 1, "visits": -1 }], 0, 1))
    false
  } catch {
    _ => true
  }
  assert_eq(rejected, true)
}

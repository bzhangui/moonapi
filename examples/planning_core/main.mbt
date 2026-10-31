///|
fn main raise {
  let value = @engine.numeric_candidate({
    "lower": { "coefficient": "9223372036854775807", "exponent": 0 },
    "step": { "coefficient": "1", "exponent": 0 },
    "offset": 1,
    "integer": true,
  })
  assert_eq(@engine.field(value, "coefficient"), Json("9223372036854775808"))
  let graph = @engine.dependency_ir([{ "id": "create" }, { "id": "read" }], [
    { "from": "create", "to": "read", "kind": "link" },
  ])
  assert_eq(@engine.field(graph, "execution_authorized"), Json(false))
  let selected = @engine.coverage_schedule(
    [{ "id": "read", "count": 2, "visits": 0 }],
    42,
    1,
  )
  assert_eq(@engine.field(selected, "available"), Json(2))
  println("portable generation, dependency IR and coverage consumer passed")
}

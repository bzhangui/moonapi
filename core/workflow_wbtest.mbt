///|
test "workflow metadata validates state and dependency closure" {
  let steps : Json = [
    { "id": "create", "needs": [], "requires": [], "effects": ["owned"] },
    { "id": "noise", "needs": [], "requires": [], "effects": [] },
    { "id": "read", "needs": ["create"], "requires": ["owned"], "effects": [] },
    { "id": "verify", "needs": ["read"], "requires": [], "effects": [] },
  ]
  assert_eq(field(workflow_check(steps), "valid"), Json(true))
  assert_eq(
    field(workflow_remove(steps, "create"), "retained"),
    Json(["noise"]),
  )
  assert_eq(
    field(workflow_remove(steps, "noise"), "retained"),
    Json(["create", "read", "verify"]),
  )
  let rejected = try {
    ignore(workflow_check([{ "id": "read", "needs": ["missing"] }]))
    false
  } catch {
    _ => true
  }
  assert_eq(rejected, true)
}

///|
test "workflow assertion and outcome policies are portable" {
  for kind in ["equal", "not_equal", "exists", "absent", "status", "count"] {
    assert_eq(field(workflow_assert(kind, true), "passed"), Json(true))
    assert_eq(
      workflow_category(text(field(workflow_assert(kind, false), "code"))),
      "defect",
    )
  }
  assert_eq(workflow_category("transport"), "transport")
  assert_eq(workflow_category("access_or_rate_limit"), "inconclusive")
  assert_eq(workflow_category("total_deadline"), "budget")
  assert_eq(workflow_category("serialization_or_auth_blocked"), "blocked")
  assert_eq(workflow_category("unsupported_codec"), "unsupported")
}

///|
test "workflow reduction properties and malformed metadata are bounded" {
  for size = 1; size <= 64; size = size + 1 {
    let steps : Array[Json] = []
    for i = 0; i < size; i = i + 1 {
      steps.push({
        "id": Json("s\{i}"),
        "needs": [],
        "requires": [],
        "effects": [],
      })
    }
    let reduced = array(field(workflow_remove(Json(steps), "s0"), "retained"))
    assert_eq(reduced.length(), size - 1)
  }
  let invalids : Array[Json] = [
    [],
    [{ "id": "same" }, { "id": "same" }],
    [{ "id": "state", "requires": ["missing"] }],
    [{ "id": "dependency", "needs": [17] }],
  ]
  for invalid in invalids {
    let rejected = try {
      ignore(workflow_check(invalid))
      false
    } catch {
      _ => true
    }
    assert_eq(rejected, true)
  }
  let rejected = try {
    ignore(workflow_assert("unknown", true))
    false
  } catch {
    _ => true
  }
  assert_eq(rejected, true)
}

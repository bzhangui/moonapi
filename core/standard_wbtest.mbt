///|
test "runtime expression AST is portable and preserves opaque pointer tokens" {
  assert_eq(field(standard_expression("$url"), "key"), Json("url"))
  for source in ["request", "response"] {
    for
      location in [
        "header.X-Id", "query.a.b", "path.id", "body", "body#/a~1b/~0key",
      ] {
      let value = standard_expression("$" + source + "." + location)
      assert_eq(field(value, "source"), Json(source))
    }
  }
  assert_eq(
    field(standard_expression("$request.body#/a~1b"), "pointer"),
    Json("/a~1b"),
  )
  assert_eq(field(standard_expression("$request.query."), "key"), Json(""))
  for
    value in [
      "$other.body", "$request.headers.a", "$response.body#not-pointer", "$response.body#/bad~2",
      "$request.header.", "$request.header.a b",
    ] {
    let rejected = try {
      ignore(standard_expression(value))
      false
    } catch {
      _ => true
    }
    assert_eq(rejected, true)
  }
}

///|
test "registered QUERY is safe but case-sensitive custom methods are not promoted" {
  for verb in ["GET", "HEAD", "OPTIONS", "QUERY"] {
    assert_eq(standard_read_only(verb), true)
  }
  for verb in ["get", "query", "POST", "COPY", "copy", "CONNECT"] {
    assert_eq(standard_read_only(verb), false)
  }
}

///|
test "standard scheduler is fair and repeatable" {
  let catalog : Json = [
    { "id": "alpha", "count": 4 },
    { "id": "beta", "count": 2 },
    { "id": "gamma", "count": 1 },
  ]
  let result = standard_schedule(catalog, 0, 3)
  assert_eq(field(result, "truncated"), Json(true))
  let choices = array(field(result, "selected"))
  assert_eq(choices.length(), 3)
  assert_eq(field(choices[0], "operation_id"), Json("alpha"))
  assert_eq(field(choices[1], "operation_id"), Json("beta"))
  assert_eq(field(choices[2], "operation_id"), Json("gamma"))
  assert_eq(result, standard_schedule(catalog, 0, 3))
  assert_eq(field(standard_schedule(catalog, 1, 7), "truncated"), Json(false))
}

///|
test "standard oracle rejects positive 4xx and auth blocks" {
  assert_eq(field(standard_oracle(200, false, true), "passed"), Json(true))
  assert_eq(field(standard_oracle(400, true, true), "passed"), Json(true))
  for status in [0, 302, 400, 401, 403, 429, 500] {
    assert_eq(
      field(standard_oracle(status, false, true), "passed"),
      Json(false),
    )
  }
  assert_eq(
    field(standard_oracle(200, true, true), "code"),
    Json("negative_accepted"),
  )
  assert_eq(
    field(standard_oracle(200, false, false), "code"),
    Json("response_contract"),
  )
}

///|
test "standard completeness requires all cases and obligations" {
  assert_eq(field(standard_verdict(3, 3, 0, 0, false), "passed"), Json(true))
  for
    args in [
      (0, 0, 0, 0, false),
      (3, 2, 0, 0, false),
      (3, 3, 1, 0, false),
      (3, 3, 0, 1, false),
      (3, 3, 0, 0, true),
    ] {
    let (planned, executed, failed, blocked, truncated) = args
    assert_eq(
      field(
        standard_verdict(planned, executed, failed, blocked, truncated),
        "complete",
      ),
      Json(false),
    )
  }
  assert_eq(
    field(standard_verdict(3, 3, 0, 0, false), "full_openapi_support"),
    Json(false),
  )
}

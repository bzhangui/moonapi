///|
test "bounded JSON and strict scalar contracts" {
  let schema : Json = { "type": "integer", "minimum": 0, "maximum": 10 }
  assert_true(validate_value(schema, 5).is_empty())
  assert_true(!validate_value(schema, 1.5).is_empty())
  assert_true(!validate_value(schema, 11).is_empty())
  assert_true(!validate_value(schema, "5").is_empty())
  assert_true(
    validate_value({ "type": "string", "maxLength": 1 }, "😀").is_empty(),
  )
}

///|
test "objects arrays required enum and nullable" {
  let schema : Json = {
    "type": "object",
    "required": ["id"],
    "properties": { "id": { "type": "integer" } },
    "additionalProperties": false,
  }
  assert_true(validate_value(schema, { "id": 1 }).is_empty())
  assert_true(!validate_value(schema, {}).is_empty())
  assert_true(!validate_value(schema, { "id": 1, "other": true }).is_empty())
  assert_true(
    validate_value({ "type": "string", "nullable": true }, null).is_empty(),
  )
  assert_true(
    !validate_value({ "type": "string", "enum": ["a", "b"] }, "c").is_empty(),
  )
}

///|
test "schema generation is deterministic" {
  let schema : Json = {
    "type": "object",
    "required": ["name"],
    "properties": {
      "name": { "type": "string", "minLength": 3 },
      "enabled": { "type": "boolean" },
      "numbers": {
        "type": "array",
        "minItems": 2,
        "items": { "type": "integer", "minimum": 0, "maximum": 10 },
      },
    },
  }
  let value = generate_value(schema, 42)
  assert_true(value == generate_value(schema, 42))
  assert_true(validate_value(schema, value).is_empty())
}

///|
fn fixture_spec() -> Spec raise {
  let source =
    #|{"openapi":"3.0.3","paths":{"/items":{"post":{"operationId":"create","requestBody":{"content":{"application/json":{"schema":{"type":"object","required":["name"],"properties":{"name":{"type":"string","minLength":1,"maxLength":20},"optional":{"type":"integer","minimum":0,"maximum":10}}}}}},"responses":{"201":{"content":{"application/json":{"schema":{"type":"object","required":["id"],"properties":{"id":{"type":"integer"}}}}}},"400":{"content":{"application/json":{"schema":{"type":"object","properties":{"error":{"type":"string"}}}}}}}}},"/items/{id}":{"get":{"operationId":"read","parameters":[{"name":"id","in":"path","required":true,"schema":{"type":"integer","minimum":1}}],"responses":{"200":{"content":{"application/json":{"schema":{"type":"object","required":["id"],"properties":{"id":{"type":"integer"}}}}}},"404":{}}}}}}
  parse_openapi(source)
}

///|
test "OpenAPI local references deterministic operation ordering and budgets" {
  for status in ["2a1", "5X9", "20", "600", "099"] {
    let responses : Map[String, Json] = Map([])
    responses[status] = {}
    let malformed : Json = {
      "openapi": "3.0.3",
      "paths": {
        "/probe": {
          "get": { "operationId": "probe", "responses": Json(responses) },
        },
      },
    }
    assert_true(
      try {
        ignore(parse_openapi(malformed.stringify()))
        false
      } catch {
        _ => true
      },
    )
  }
  let spec = fixture_spec()
  assert_true(spec.operations.length() == 2)
  let cases = plan(spec, limit=8)
  assert_true(cases.length() == 8)
  assert_true(cases.any(c => c.negative))
  assert_true(plan(spec, seed=99, limit=1).length() == 1)
  assert_true(
    generate_value({ "type": "integer", "minimum": 0.5, "maximum": 2.5 }, 0) ==
    1,
  )
  assert_true(
    generate_value({ "type": "integer", "minimum": 0.5, "maximum": 2.5 }, 1) ==
    2,
  )
}

///|
test "negative inputs server errors exact response types and fingerprints" {
  let op = operation(fixture_spec(), "create")
  let case_ = make_case(op, 42)
  assert_true(validate_response(op, case_, 201, { "id": 1 }).passed)
  assert_true(!validate_response(op, case_, 201, { "id": "wrong" }).passed)
  assert_true(
    validate_response(op, case_, 201, { "id": "wrong" }).fingerprint ==
    "201:type:$/id",
  )
  assert_true(!validate_response(op, case_, 500, { "error": "broken" }).passed)
  assert_true(
    !validate_response(op, { ..case_, negative: true, }, 201, { "id": 1 }).passed,
  )
  assert_true(
    validate_response(op, { ..case_, negative: true, }, 400, {
      "error": "invalid",
    }).passed,
  )
}

///|
test "failure shrinking retains valid request semantics" {
  let op = operation(fixture_spec(), "create")
  let case_ = make_case(op, 42)
  let smaller = shrink_candidates(op, case_)
  assert_true(!smaller.is_empty())
  for candidate in smaller {
    assert_true(validate_value(op.request, candidate.body).is_empty())
    assert_true(
      candidate.body.stringify().length() < case_.body.stringify().length(),
    )
  }
}

///|
test "stateful captures bind actual identifiers without evaluation" {
  let spec = fixture_spec()
  let bindings = capture_values(
    { "capture": { "item_id": "/id" } },
    { "id": 7 },
    Json::empty_object(),
  )
  let next = scenario_case(
    spec,
    {
      "operationId": "read",
      "parameters": { "id": { "$from": "item_id" } },
      "status": 200,
    },
    bindings,
  )
  assert_true(field(next.parameters[0], "value") == 7)
  assert_true(next.expected_status == 200)
  assert_true(json_pointer({ "a/b": { "~x": [42] } }, "/a~1b/~0x/0") == 42)
}

///|
test "numbers do not gain undeclared magnitude restrictions" {
  assert_true(validate_value({ "type": "number" }, 10000000000000.0).is_empty())
  assert_true(validate_value({ "type": "integer" }, 2147483648.0).is_empty())
  assert_true(
    !validate_value({ "type": "integer" }, 9007199254740992.0).is_empty(),
  )
  assert_true(
    !validate_value({ "type": "string", "nullable": true, "enum": ["a"] }, null).is_empty(),
  )
}

///|
test "local references unsupported features and cycles fail closed" {
  let source : Json = {
    "openapi": "3.0.3",
    "components": {
      "schemas": { "Value": { "type": "string", "enum": ["a", "b"] } },
    },
    "paths": {
      "/x": {
        "get": {
          "operationId": "x",
          "responses": {
            "200": {
              "content": {
                "application/json": {
                  "schema": { "$ref": "#/components/schemas/Value" },
                },
              },
            },
          },
        },
      },
    },
  }
  assert_true(parse_openapi(source.stringify()).operations.length() == 1)
  let invalid_schemas : Array[Json] = [
    { "oneOf": [{ "type": "string" }] },
    { "$ref": "https://example.com/value" },
    { "type": "string", "pattern": ".*" },
    { "type": "integer", "enum": ["wrong"] },
  ]
  for schema in invalid_schemas {
    let invalid : Json = {
      "openapi": "3.0.3",
      "paths": {
        "/x": {
          "get": {
            "operationId": "x",
            "responses": {
              "200": { "content": { "application/json": { "schema": schema } } },
            },
          },
        },
      },
    }
    assert_true(
      try {
        ignore(parse_openapi(invalid.stringify()))
        false
      } catch {
        _ => true
      },
    )
  }
  let recursive : Json = {
    "openapi": "3.0.3",
    "components": {
      "schemas": { "Loop": { "$ref": "#/components/schemas/Loop" } },
    },
    "paths": {
      "/x": {
        "get": {
          "operationId": "x",
          "responses": {
            "200": {
              "content": {
                "application/json": {
                  "schema": { "$ref": "#/components/schemas/Loop" },
                },
              },
            },
          },
        },
      },
    },
  }
  assert_true(
    try {
      ignore(parse_openapi(recursive.stringify()))
      false
    } catch {
      _ => true
    },
  )
}

///|
test "source input and resource budgets reject before expansive work" {
  assert_true(
    try {
      ignore(bounded_json("[".repeat(49)))
      false
    } catch {
      _ => true
    },
  )
  assert_true(
    try {
      ignore(plan(fixture_spec(), limit=257))
      false
    } catch {
      _ => true
    },
  )
  assert_true(
    try {
      ignore(generate_value({ "type": "string", "minLength": 4097 }, 1))
      false
    } catch {
      _ => true
    },
  )
  let inverted : Json = { "type": "integer", "minimum": 0.1, "maximum": 0.9 }
  assert_true(
    try {
      ignore(generate_value(inverted, 1))
      false
    } catch {
      _ => true
    },
  )
}

///|
test "response errors distinguish access invalid JSON and explicit scenario assertions" {
  let op = operation(fixture_spec(), "create")
  let case_ = make_case(op, 42)
  assert_true(!validate_response(op, case_, 201, null, json_valid=false).passed)
  assert_true(!validate_response(op, case_, 429, {}).passed)
  assert_true(
    !validate_response(op, { ..case_, expected_status: 200, }, 201, { "id": 1 }).passed,
  )
  assert_true(!validate_response(op, case_, 302, {}).passed)
}

///|
test "missing and oversized scenario variables are rejected" {
  assert_true(
    try {
      ignore(json_pointer({ "id": 1 }, "/missing"))
      false
    } catch {
      _ => true
    },
  )
  assert_true(
    try {
      ignore(
        scenario_case(
          fixture_spec(),
          {
            "operationId": "read",
            "parameters": { "id": { "$from": "unknown" } },
          },
          {},
        ),
      )
      false
    } catch {
      _ => true
    },
  )
  assert_true(
    try {
      ignore(
        capture_values(
          { "capture": { "data": "/text" } },
          { "text": Json("x".repeat(9000)) },
          {},
        ),
      )
      false
    } catch {
      _ => true
    },
  )
}

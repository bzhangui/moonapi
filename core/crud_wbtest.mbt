///|
fn crud_test_spec() -> Spec {
  let body : Json = {
    "type": "object",
    "required": ["name"],
    "properties": {
      "name": { "type": "string", "minLength": 1, "maxLength": 64 },
    },
  }
  let record : Json = {
    "type": "object",
    "required": ["id", "name"],
    "properties": { "id": { "type": "integer" }, "name": { "type": "string" } },
  }
  let parameter : Json = {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": { "type": "integer" },
  }
  {
    operations: [
      {
        id: "create",
        verb: "POST",
        path: "/items",
        parameters: [],
        request: body,
        responses: { "201": record },
      },
      {
        id: "read",
        verb: "GET",
        path: "/items/{id}",
        parameters: [parameter],
        request: null,
        responses: { "200": record, "404": null },
      },
      {
        id: "update",
        verb: "PUT",
        path: "/items/{id}",
        parameters: [parameter],
        request: body,
        responses: { "200": record },
      },
      {
        id: "delete",
        verb: "DELETE",
        path: "/items/{id}",
        parameters: [parameter],
        request: null,
        responses: { "204": null },
      },
    ],
  }
}

///|
test "CRUD profile derives all six steps without a hand authored FSM" {
  let plan = crud_plan(
    crud_test_spec(),
    "/items",
    "name",
    "moonapi_111111111111111111111111",
    "moonapi_222222222222222222222222",
  )
  let trace = field(plan, "trace")
  validate_sequence(trace)
  let steps = array(field(trace, "steps"))
  assert_eq(steps.length(), 6)
  assert_eq(field(plan, "full_openapi_support"), false)
  assert_eq(field(steps[5], "status"), 404)
  assert_true(
    sequence_candidates(trace).any(t => array(field(t, "steps")).length() < 6),
  )
}

///|
test "CRUD refuses ambiguous update operations and invalid marker before network" {
  let original = crud_test_spec()
  let dup = { ..original.operations[2], id: "patch", verb: "PATCH", }
  let ambiguous = { operations: original.operations.copy(), }
  ambiguous.operations.push(dup)
  for spec in [ambiguous, { operations: [], }] {
    assert_true(
      try {
        ignore(
          crud_plan(
            spec, "/items", "name", "moonapi_111111111111111111111111", "moonapi_222222222222222222222222",
          ),
        )
        false
      } catch {
        _ => true
      },
    )
  }
  for field_name in ["id", "missing", "a/b"] {
    assert_true(
      try {
        ignore(
          crud_plan(
            original, "/items", field_name, "moonapi_111111111111111111111111", "moonapi_222222222222222222222222",
          ),
        )
        false
      } catch {
        _ => true
      },
    )
  }
  let unsafe_create = {
    ..original.operations[0],
    request: {
      "type": "object",
      "properties": {
        "name": { "type": "string" },
        "id": { "type": "integer" },
      },
    },
  }
  let unsafe_spec = { operations: original.operations.copy(), }
  unsafe_spec.operations[0] = unsafe_create
  assert_true(
    try {
      ignore(
        crud_plan(
          unsafe_spec, "/items", "name", "moonapi_111111111111111111111111", "moonapi_222222222222222222222222",
        ),
      )
      false
    } catch {
      _ => true
    },
  )
}

///|
test "component references support RFC6901 escaped names and same kind chains" {
  let root : Json = {
    "components": {
      "parameters": {
        "a/b~c": { "$ref": "#/components/parameters/final" },
        "final": { "name": "id", "in": "path" },
      },
      "schemas": { "a/b": { "type": "string" } },
    },
  }
  assert_eq(
    field(
      resolve_component(
        root,
        { "$ref": "#/components/parameters/a~1b~0c" },
        "parameters",
        0,
      ),
      "name",
    ),
    "id",
  )
  assert_eq(
    field(
      resolve_schema(root, { "$ref": "#/components/schemas/a~1b" }, 0),
      "type",
    ),
    "string",
  )
}

///|
test "reference cycles external sources wrong kinds and sibling intent fail closed" {
  let root : Json = {
    "components": {
      "parameters": { "loop": { "$ref": "#/components/parameters/loop" } },
    },
  }
  let bad : Array[Json] = [
    { "$ref": "#/components/parameters/loop" },
    { "$ref": "#/components/responses/no" },
    { "$ref": "https://example.invalid/spec" },
    { "$ref": "#/components/parameters/a~2" },
    { "$ref": "#/components/parameters/missing" },
    { "$ref": "#/components/parameters/loop", "required": true },
    { "$ref": 1 },
  ]
  for value in bad {
    assert_true(
      try {
        ignore(resolve_component(root, value, "parameters", 0))
        false
      } catch {
        _ => true
      },
    )
  }
}

///|
test "readOnly writeOnly projection preserves directional required constraints" {
  let schema : Json = {
    "type": "object",
    "required": ["id", "secret", "name"],
    "additionalProperties": false,
    "properties": {
      "id": { "type": "integer", "readOnly": true },
      "secret": { "type": "string", "writeOnly": true },
      "name": { "type": "string" },
    },
  }
  let request = project_schema(resolve_schema({}, schema, 0), true)
  let response = project_schema(resolve_schema({}, schema, 0), false)
  assert_true(
    validate_value(request, { "name": "yes", "secret": "private" }).is_empty(),
  )
  assert_true(validate_value(response, { "name": "yes", "id": 1 }).is_empty())
  assert_true(!validate_value(response, { "name": "yes" }).is_empty())
  assert_true(
    !validate_value(response, { "name": "yes", "id": 1, "secret": "private" }).is_empty(),
  )
  assert_true(field(generate_value(request, 42), "id") == null)
  let nested = project_schema({ "type": "array", "items": schema }, true)
  assert_true(
    validate_value(nested, [{ "name": "yes", "secret": "private" }]).is_empty(),
  )
}

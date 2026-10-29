///|
fn probe_modern(schema : String, value : String) -> Bool raise {
  let empty = Json::empty_object()
  let result = modern_validate(
    @json.parse(schema, preserve_number_repr=true),
    empty,
    @json.parse(value, preserve_number_repr=true),
    empty,
    fn(p, s) { p == s },
    fn(_, _) { true },
  )
  field(result, "valid") == Json(true)
}

///|
test "modern portable exact integer and decimal rules" {
  assert_true(
    probe_modern(
      "{\"type\":\"integer\",\"maximum\":9223372036854775807}", "9223372036854775807",
    ),
  )
  assert_false(
    probe_modern("{\"maximum\":9223372036854775807}", "9223372036854775808"),
  )
  assert_false(probe_modern("{\"type\":\"integer\"}", "1.00000000000000001"))
  assert_true(probe_modern("{\"multipleOf\":0.1}", "0.3"))
  assert_false(probe_modern("{\"multipleOf\":0.1}", "0.30000000000000001"))
}

///|
test "modern portable deep exact uniqueness and unicode lengths" {
  assert_false(
    probe_modern(
      "{\"uniqueItems\":true}", "[{\"x\":1.0,\"a\":true},{\"a\":true,\"x\":1}]",
    ),
  )
  assert_true(
    probe_modern(
      "{\"uniqueItems\":true}", "[9223372036854775807,9223372036854775808]",
    ),
  )
  assert_true(probe_modern("{\"minLength\":1,\"maxLength\":1}", "\"😀\""))
}

///|
test "modern portable successful annotation sets and conditional dependencies" {
  assert_true(
    probe_modern(
      "{\"anyOf\":[{\"properties\":{\"a\":true}},{\"properties\":{\"b\":true}}],\"unevaluatedProperties\":false}",
      "{\"a\":1,\"b\":2}",
    ),
  )
  assert_false(
    probe_modern(
      "{\"anyOf\":[{\"properties\":{\"a\":true},\"required\":[\"missing\"]},true],\"unevaluatedProperties\":false}",
      "{\"a\":1}",
    ),
  )
  assert_true(
    probe_modern(
      "{\"contains\":{\"type\":\"integer\"},\"minContains\":0,\"unevaluatedItems\":{\"type\":\"string\"}}",
      "[\"s\",1,\"t\",2]",
    ),
  )
  assert_false(
    probe_modern("{\"dependentRequired\":{\"a\":[\"b\"]}}", "{\"a\":1}"),
  )
}

///|
test "modern portable property names patterns formats and directional policy" {
  let empty = Json::empty_object()
  let schema : Json = {
    "type": "object",
    "patternProperties": { "a": { "const": 1 } },
    "propertyNames": { "pattern": "a" },
    "unevaluatedProperties": false,
  }
  let valid = modern_validate(
    schema,
    empty,
    { "a": 1 },
    empty,
    fn(p, s) { p == s },
    fn(_, _) { true },
  )
  assert_eq(field(valid, "valid"), Json(true))
  let bad = modern_validate(
    schema,
    empty,
    { "b": 1 },
    empty,
    fn(p, s) { p == s },
    fn(_, _) { true },
  )
  assert_eq(field(bad, "valid"), Json(false))
  let forbidden = modern_validate(
    { "readOnly": true },
    empty,
    1,
    empty,
    fn(_, _) { true },
    fn(_, _) { true },
    mode="write",
    direction="reject-forbidden",
  )
  assert_eq(field(forbidden, "valid"), Json(false))
  for value in ["9223372036854775807", "9223372036854775808"] {
    let result = modern_validate(
      { "format": "int64" },
      empty,
      @json.parse(value, preserve_number_repr=true),
      empty,
      fn(_, _) { true },
      fn(_, _) { abort("int64 must not be delegated") },
      assert_formats=true,
    )
    assert_eq(field(result, "valid"), Json(value == "9223372036854775807"))
  }
}

///|
test "modern portable complete keyword families retain passing and failing controls" {
  let cases : Array[(Json, Json, Bool)] = [
    (true, null, true),
    (false, null, false),
    ({ "type": ["null", "integer"] }, null, true),
    ({ "type": "boolean" }, true, true),
    ({ "type": "boolean" }, "true", false),
    (
      { "const": { "x": [true, false, null] } },
      { "x": [true, false, null] },
      true,
    ),
    ({ "enum": [null, true, "ok"] }, false, false),
    ({ "enum": [null, true] }, true, true),
    ({ "minimum": 1 }, 0, false),
    ({ "maximum": 1 }, 2, false),
    ({ "exclusiveMinimum": 1 }, 1, false),
    ({ "exclusiveMaximum": 1 }, 1, false),
    ({ "type": "string", "minLength": 2 }, "x", false),
    ({ "type": "string", "maxLength": 1 }, "xx", false),
    ({ "pattern": "a" }, "b", false),
    ({ "allOf": [{ "minimum": 1 }, { "maximum": 3 }] }, 2, true),
    ({ "allOf": [{ "minimum": 1 }] }, 0, false),
    ({ "anyOf": [false, false] }, 0, false),
    ({ "oneOf": [true, true] }, 0, false),
    ({ "oneOf": [false, true] }, 0, true),
    ({ "not": { "type": "string" } }, "x", false),
    (
      {
        "if": { "type": "number" },
        "then": { "minimum": 2 },
        "else": { "type": "string" },
      },
      1,
      false,
    ),
    (
      { "if": { "type": "number" }, "then": true, "else": { "type": "string" } },
      "a",
      true,
    ),
    ({ "if": false, "else": false }, 0, false),
    ({ "minProperties": 1 }, {}, false),
    ({ "maxProperties": 0 }, { "a": 0 }, false),
    ({ "required": ["a"] }, {}, false),
    (
      {
        "properties": { "a": { "type": "number" } },
        "additionalProperties": false,
      },
      { "a": "x" },
      false,
    ),
    (
      { "properties": { "a": true }, "additionalProperties": false },
      { "a": 0, "b": 1 },
      false,
    ),
    ({ "additionalProperties": { "type": "boolean" } }, { "x": true }, true),
    ({ "dependentSchemas": { "a": { "required": ["b"] } } }, { "a": 1 }, false),
    (
      {
        "dependentSchemas": { "a": { "properties": { "b": true } } },
        "properties": { "a": true },
        "unevaluatedProperties": false,
      },
      { "a": 1, "b": 0 },
      true,
    ),
    ({ "minItems": 1 }, [], false),
    ({ "maxItems": 0 }, [1], false),
    ({ "prefixItems": [{ "const": 1 }], "items": false }, [1], true),
    ({ "prefixItems": [{ "const": 1 }], "items": false }, [2], false),
    ({ "prefixItems": [true], "items": { "type": "string" } }, [0, "ok"], true),
    ({ "contains": { "type": "integer" } }, ["x"], false),
    ({ "contains": true, "maxContains": 1 }, [1, 2], false),
    (
      { "contains": { "type": "integer" }, "unevaluatedItems": false },
      [1, "x"],
      false,
    ),
  ]
  let empty = Json::empty_object()
  for (schema, value, expected) in cases {
    let result = modern_validate(
      schema,
      empty,
      value,
      empty,
      fn(p, s) { p == s },
      fn(_, _) { true },
    )
    assert_eq(field(result, "valid"), Json(expected))
  }
  assert_true(probe_modern("{\"const\":1200}", "1.2e+3"))
  assert_true(probe_modern("{\"const\":-0.0012}", "-12e-4"))
}

///|
test "modern portable references binary identity and errors are not host fallbacks" {
  let empty = Json::empty_object()
  let leaves = fn(_, _) { true }
  let docs : Json = { "r": { "type": "integer", "minimum": 1 } }
  let result = modern_validate(
    { "$ref": "r", "maximum": 2 },
    docs,
    1,
    empty,
    leaves,
    leaves,
  )
  assert_eq(field(result, "valid"), Json(true))
  let bad = modern_validate({ "$ref": "r" }, docs, 0, empty, leaves, leaves)
  assert_eq(field(bad, "valid"), Json(false))
  let binary : Json = { "/0": "00ff", "/1": "00ff" }
  let unique = modern_validate(
    { "uniqueItems": true },
    empty,
    [null, null],
    binary,
    leaves,
    leaves,
  )
  assert_eq(field(unique, "valid"), Json(false))
  let typed = modern_validate(
    { "type": "object" },
    empty,
    null,
    { "": "00ff" },
    leaves,
    leaves,
  )
  assert_eq(field(typed, "valid"), Json(false))
  let name = modern_validate(
    { "propertyNames": { "type": "string" } },
    empty,
    { "/~/": null },
    { "/~1~0~1": "00" },
    leaves,
    leaves,
  )
  assert_eq(field(name, "valid"), Json(true))
  let fmt = modern_validate(
    { "format": "email" },
    empty,
    "bad",
    empty,
    leaves,
    fn(_, _) { false },
    assert_formats=true,
  )
  assert_eq(field(fmt, "valid"), Json(false))
  let invalid_refs : Array[(Json, Json)] = [
    ({ "$ref": "missing" }, empty),
    ({ "$ref": "r" }, { "r": { "$ref": "r" } }),
    ({ "multipleOf": 0 }, empty),
  ]
  for (schema, documents) in invalid_refs {
    let rejected = try {
      ignore(modern_validate(schema, documents, 1, empty, leaves, leaves))
      false
    } catch {
      _ => true
    }
    assert_true(rejected)
  }
  let policy = try {
    ignore(
      modern_validate(true, empty, 1, empty, leaves, leaves, mode="unknown"),
    )
    false
  } catch {
    _ => true
  }
  assert_true(policy)
}

///|
test "modern portable numeric structural and recursive budgets refuse excessive work" {
  for text in ["1e10001", "1e-10001", "10e10000"] {
    let rejected = try {
      ignore(probe_modern("true", text))
      false
    } catch {
      _ => true
    }
    assert_true(rejected)
  }
  let empty = Json::empty_object()
  let leaves = fn(_, _) { true }
  let mut deep : Json = null
  for _ in 0..<66 {
    deep = Json([deep])
  }
  let depth_error = try {
    ignore(modern_validate(true, empty, deep, empty, leaves, leaves))
    false
  } catch {
    _ => true
  }
  assert_true(depth_error)
  let mut schema : Json = true
  for _ in 0..<260 {
    schema = Json({ "allOf": Json([schema]) })
  }
  let schema_error = try {
    ignore(modern_validate(schema, empty, 0, empty, leaves, leaves))
    false
  } catch {
    _ => true
  }
  assert_true(schema_error)
  let many = Json(Array::make(50000, Json::null()))
  let count_error = try {
    ignore(modern_validate(true, empty, many, empty, leaves, leaves))
    false
  } catch {
    _ => true
  }
  assert_true(count_error)
}

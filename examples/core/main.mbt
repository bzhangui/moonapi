///|
fn main {
  try {
    let schema : Json = {
      "type": "object",
      "required": ["id"],
      "properties": { "id": { "type": "integer", "minimum": 1, "maximum": 10 } },
    }
    let value = @engine.generate_value(schema, 42)
    guard @engine.validate_value(schema, value).is_empty() else {
      abort("generated value violated schema")
    }
    println(value.stringify())
    // Public 0.9 instance engine: this example needs no host regex/format leaves.
    let modern_schema = @json.parse(
      "{\"type\":\"integer\",\"maximum\":9223372036854775807}",
      preserve_number_repr=true,
    )
    let exact = @json.parse("9223372036854775807", preserve_number_repr=true)
    let result = @engine.modern_validate(
      modern_schema,
      Json::empty_object(),
      exact,
      Json::empty_object(),
      fn(_, _) { abort("regex provider required") },
      fn(_, _) { abort("format provider required") },
    )
    assert_eq(@engine.field(result, "valid"), Json(true))
    println("modern exact int64: verified=true")
    println("portable core: verified=true")
  } catch {
    _ => abort("portable core example failed")
  }
}

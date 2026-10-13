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
    println("portable core: verified=true")
  } catch {
    _ => abort("portable core example failed")
  }
}

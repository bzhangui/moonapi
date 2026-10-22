///|
// OAS 3.0 readOnly/writeOnly changes property requiredness by direction.
// Do not weaken unrelated fields or reuse request projection for responses.
fn project_schema(schema : Json, request : Bool) -> Json {
  let copy : Map[String, Json] = Map([])
  for key in fields(schema) {
    copy[key] = field(schema, key)
  }
  if field(schema, "type") == "object" {
    let mapped : Map[String, Json] = Map([])
    for name in fields(field(schema, "properties")) {
      let property = field(field(schema, "properties"), name)
      let omitted = if request {
        field(property, "readOnly") is True
      } else {
        field(property, "writeOnly") is True
      }
      if !omitted {
        mapped[name] = project_schema(property, request)
      }
    }
    copy["properties"] = Json(mapped)
    if fields(schema).contains("required") {
      copy["required"] = Json(
        array(field(schema, "required")).filter(name => {
          match name {
            String(key) => mapped.contains(key)
            _ => false
          }
        }),
      )
    }
  }
  if field(schema, "type") == "array" {
    copy["items"] = project_schema(field(schema, "items"), request)
  }
  Json(copy)
}

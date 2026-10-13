///|
pub fn json_pointer(value : Json, pointer : String) -> Json raise TestError {
  guard pointer.length() <= 512 && (pointer == "" || pointer.has_prefix("/")) else {
    raise Invalid("invalid JSON pointer")
  }
  if pointer == "" {
    return value
  }
  let parts = pointer[1:].split("/").map(v => v.to_owned()).to_array()
  guard parts.length() <= 16 else {
    raise Invalid("JSON pointer depth exceeded")
  }
  let mut current = value
  for encoded in parts {
    let part = encoded
      .replace_all(old="~1", new="/")
      .replace_all(old="~0", new="~")
    match current {
      Object(map) =>
        current = map
          .get(part)
          .unwrap_or_else(() => raise Invalid("capture pointer not found"))
      Array(xs) => {
        guard part.length() > 0 && part.length() <= 5 else {
          raise Invalid("invalid array pointer")
        }
        let mut index = 0
        for c in part {
          guard c >= '0' && c <= '9' else {
            raise Invalid("non-decimal array pointer")
          }
          index = index * 10 + c.to_int() - 48
        }
        guard index < xs.length() else {
          raise Invalid("array pointer out of range")
        }
        current = xs[index]
      }
      _ => raise Invalid("capture pointer crosses scalar")
    }
  }
  current
}

///|
fn bind_value(
  value : Json,
  bindings : Json,
  depth : Int32,
) -> Json raise TestError {
  guard depth <= 16 else { raise Invalid("scenario binding depth exceeded") }
  if field(value, "$from") is String(name) {
    guard fields(value) == ["$from"] && fields(bindings).contains(name) else {
      raise Invalid("unknown or ambiguous scenario variable")
    }
    return field(bindings, name)
  }
  match value {
    Object(_) => {
      let output : Map[String, Json] = Map([])
      for name in fields(value) {
        output[name] = bind_value(field(value, name), bindings, depth + 1)
      }
      Json(output)
    }
    Array(xs) => {
      guard xs.length() <= 64 else { raise Invalid("scenario array budget") }
      Json(xs.map(v => bind_value(v, bindings, depth + 1)))
    }
    _ => value
  }
}

///|
pub fn scenario_case(
  spec : Spec,
  step : Json,
  bindings : Json,
  seed~ : Int32 = 42,
) -> Case raise TestError {
  check_object(step, "scenario step must be object")
  let op = operation(spec, text(field(step, "operationId")))
  let base = make_case(op, seed)
  let parameters : Array[Json] = []
  let provided = field(step, "parameters")
  for parameter in base.parameters {
    let name = text(field(parameter, "name"))
    let value = if fields(provided).contains(name) {
      bind_value(field(provided, name), bindings, 0)
    } else {
      field(parameter, "value")
    }
    for declared in op.parameters {
      if field(declared, "name") == Json(name) {
        guard validate_value(field(declared, "schema"), value).is_empty() else {
          raise Invalid("bound parameter violates schema")
        }
      }
    }
    parameters.push({
      "name": Json(name),
      "in": field(parameter, "in"),
      "value": value,
    })
  }
  for name in fields(provided) {
    guard op.parameters.any(p => field(p, "name") == Json(name)) else {
      raise Invalid("scenario parameter not declared")
    }
  }
  let body = if fields(step).contains("body") {
    bind_value(field(step, "body"), bindings, 0)
  } else {
    base.body
  }
  let negative = field(step, "negative") is True
  if fields(step).contains("negative") {
    guard field(step, "negative") is True || field(step, "negative") is False else {
      raise Invalid("scenario negative must be boolean")
    }
  }
  if op.request != null {
    guard validate_value(op.request, body).is_empty() != negative else {
      raise Invalid("scenario request validity disagrees with negative marker")
    }
  }
  let expected = numeric(field(step, "status"), 0.0)
  if fields(step).contains("status") {
    guard field(step, "status") is Number(_, ..) else {
      raise Invalid("scenario status must be number")
    }
  }
  guard expected == expected.to_int().to_double() &&
    (expected == 0.0 || (expected >= 100.0 && expected <= 599.0)) else {
    raise Invalid("invalid scenario status")
  }
  { ..base, parameters, body, negative, expected_status: expected.to_int(), }
}

///|
pub fn capture_values(
  step : Json,
  body : Json,
  bindings : Json,
) -> Json raise TestError {
  let output : Map[String, Json] = Map([])
  for name in fields(bindings) {
    output[name] = field(bindings, name)
  }
  let captures = field(step, "capture")
  guard fields(captures).length() <= 16 else {
    raise Invalid("capture count budget")
  }
  for name in fields(captures) {
    safe_name(name)
    let value = json_pointer(body, text(field(captures, name)))
    guard @utf8.encode(value.stringify()).length() <= 8192 else {
      raise Invalid("capture value budget")
    }
    output[name] = value
  }
  guard output.length() <= 64 else { raise Invalid("scenario variable budget") }
  Json(output)
}

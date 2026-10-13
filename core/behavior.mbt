///|
pub fn make_case(op : Operation, seed : Int32) -> Case raise TestError {
  let parameters : Array[Json] = []
  for parameter in op.parameters {
    let value = generate_value(field(parameter, "schema"), seed)
    guard validate_value(field(parameter, "schema"), value).is_empty() else {
      raise Invalid("generated parameter violates schema")
    }
    parameters.push({
      "name": field(parameter, "name"),
      "in": field(parameter, "in"),
      "value": value,
    })
  }
  let body = if op.request == null {
    null
  } else {
    generate_value(op.request, seed)
  }
  if op.request != null {
    guard validate_value(op.request, body).is_empty() else {
      raise Invalid("schema has no supported valid generated value")
    }
  }
  guard @utf8.encode(body.stringify()).length() <= 1048576 else {
    raise Invalid("case body budget exceeded")
  }
  {
    id: op.id + "-\{seed}",
    operation_id: op.id,
    verb: op.verb,
    path: op.path,
    parameters,
    body,
    has_body: op.request != null,
    negative: false,
    expected_status: 0,
  }
}

///|
pub fn plan(
  spec : Spec,
  seed~ : Int32 = 42,
  limit~ : Int32 = 64,
) -> Array[Case] raise TestError {
  guard seed >= 0 && seed <= 1000000 && limit >= 1 && limit <= 256 else {
    raise Invalid("invalid case budget or seed")
  }
  let out = []
  for op in spec.operations {
    let sampled : Array[Int32] = []
    for sample in [seed, 0, 1] {
      if sampled.contains(sample) {
        continue
      }
      sampled.push(sample)
      if out.length() >= limit {
        return out
      }
      out.push(make_case(op, sample))
    }
    if op.request != null && out.length() < limit {
      let base = make_case(op, seed)
      let wrong = if field(op.request, "type") == "string" {
        Json(123)
      } else {
        Json("invalid-type")
      }
      out.push({
        ..base,
        id: op.id + "-wrong-type",
        body: wrong,
        negative: true,
      })
      if field(op.request, "type") == "object" && out.length() < limit {
        let required = array(field(op.request, "required"))
        if !required.is_empty() {
          let copy : Map[String, Json] = Map([])
          for key in fields(base.body) {
            if Json(key) != required[0] {
              copy[key] = field(base.body, key)
            }
          }
          out.push({
            ..base,
            id: op.id + "-missing-required",
            body: Json(copy),
            negative: true,
          })
        }
      }
    }
  }
  out
}

///|
pub fn validate_response(
  op : Operation,
  case_ : Case,
  status : Int32,
  body : Json,
  json_valid~ : Bool = true,
) -> Finding {
  let issues = []
  if status < 100 || status > 599 {
    issues.push({
      code: "transport",
      pointer: "$",
      message: "request did not produce HTTP response",
    })
  } else if status >= 500 {
    issues.push({
      code: "server_error",
      pointer: "$",
      message: "server returned 5xx",
    })
  } else if status == 401 || status == 403 || status == 429 {
    issues.push({
      code: "access_or_rate_limit",
      pointer: "$",
      message: "authentication or rate limiting prevents behavior verification",
    })
  } else {
    if case_.negative && !(status >= 400 && status < 500) {
      issues.push({
        code: "negative_accepted",
        pointer: "$",
        message: "invalid input was not rejected",
      })
    }
    if case_.expected_status != 0 && status != case_.expected_status {
      issues.push({
        code: "scenario_status",
        pointer: "$",
        message: "scenario status differs from expected",
      })
    }
    let key = "\{status}"
    let defined = fields(op.responses).contains(key) ||
      fields(op.responses).contains("default")
    if !defined {
      issues.push({
        code: "undeclared_status",
        pointer: "$",
        message: "HTTP response status absent from OpenAPI",
      })
    } else {
      let schema = if fields(op.responses).contains(key) {
        field(op.responses, key)
      } else {
        field(op.responses, "default")
      }
      if schema != null && case_.verb != "HEAD" {
        if !json_valid {
          issues.push({
            code: "invalid_json",
            pointer: "$",
            message: "JSON response body missing or malformed",
          })
        } else {
          for issue in validate_value(schema, body) {
            issues.push(issue)
          }
        }
      } else if status == 204 && body != null {
        issues.push({
          code: "unexpected_body",
          pointer: "$",
          message: "204 must have empty body",
        })
      }
    }
  }
  let fingerprint = if issues.is_empty() {
    ""
  } else {
    "\{status}:" + issues[0].code + ":" + issues[0].pointer
  }
  { passed: issues.is_empty(), fingerprint, issues, }
}

///|
pub fn shrink_candidates(
  op : Operation,
  case_ : Case,
) -> Array[Case] raise TestError {
  let candidates = []
  if !case_.has_body || case_.body == null {
    return candidates
  }
  let values : Array[Json] = []
  match case_.body {
    Object(_) => {
      for omitted in fields(case_.body) {
        let copy : Map[String, Json] = Map([])
        for key in fields(case_.body) {
          if key != omitted {
            copy[key] = field(case_.body, key)
          }
        }
        values.push(Json(copy))
      }
      for key in fields(case_.body) {
        let copy : Map[String, Json] = Map([])
        for name in fields(case_.body) {
          copy[name] = field(case_.body, name)
        }
        let old = field(case_.body, key)
        match old {
          String(s) =>
            if s.char_length() > 1 {
              copy[key] = Json(
                String::from_array(s.to_array()[0:s.char_length() / 2]),
              )
            }
          Number(_, ..) => copy[key] = 0
          Array(_) => copy[key] = []
          _ => ()
        }
        values.push(Json(copy))
      }
    }
    String(s) => {
      values.push(Json(""))
      if s.char_length() > 1 {
        values.push(Json("a"))
      }
    }
    Array(_) => values.push(Json::array([]))
    Number(_, ..) => values.push(Json(0))
    _ => ()
  }
  for body in values {
    let valid = validate_value(op.request, body).is_empty()
    if valid != case_.negative &&
      body.stringify().length() < case_.body.stringify().length() {
      candidates.push({ ..case_, body, })
      guard candidates.length() <= 128 else {
        raise Invalid("shrink candidate budget exceeded")
      }
    }
  }
  candidates
}

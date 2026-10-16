///|
fn exact_keys(value : Json, allowed : Array[String]) -> Unit raise TestError {
  check_object(value, "model object required")
  for key in fields(value) {
    guard allowed.contains(key) else { raise Invalid("unknown model field") }
  }
}

///|
fn model_name(value : Json) -> String raise TestError {
  let name = text(value)
  guard name.length() > 0 && name.length() <= 64 else {
    raise Invalid("model name budget")
  }
  for c in name {
    guard (c >= 'a' && c <= 'z') ||
      (c >= 'A' && c <= 'Z') ||
      (c >= '0' && c <= '9') ||
      c == '_' ||
      c == '-' else {
      raise Invalid("model identifier required")
    }
  }
  name
}

///|
fn model_refs(
  value : Json,
  known : Map[String, Bool],
  depth : Int32,
) -> Unit raise TestError {
  guard depth <= 16 else { raise Invalid("model expression depth") }
  if fields(value).contains("$from") {
    guard fields(value) == ["$from"] &&
      known.contains(text(field(value, "$from"))) else {
      raise Invalid("missing state dependency")
    }
    return
  }
  match value {
    Object(_) =>
      for key in fields(value) {
        model_refs(field(value, key), known, depth + 1)
      }
    Array(xs) =>
      for x in xs {
        model_refs(x, known, depth + 1)
      }
    _ => ()
  }
}

///|
fn pointer_syntax(value : Json) -> Unit raise TestError {
  let p = text(value)
  guard p.length() <= 512 && (p == "" || p.has_prefix("/")) else {
    raise Invalid("invalid assertion pointer")
  }
  guard p.split("/").to_array().length() <= 17 else {
    raise Invalid("pointer depth")
  }
  let chars = p.to_array()
  for i = 0; i < chars.length(); i = i + 1 {
    if chars[i] == '~' {
      guard i + 1 < chars.length() &&
        (chars[i + 1] == '0' || chars[i + 1] == '1') else {
        raise Invalid("pointer escape")
      }
    }
  }
}

///|
fn literal_model(value : Json) -> Unit raise TestError {
  model_refs(value, Map([]), 0)
  guard @utf8.encode(value.stringify()).length() <= 8192 else {
    raise Invalid("state value budget")
  }
}

///|
fn assertion_operand(op : String, value : Json) -> Unit raise TestError {
  if op == "gte" || op == "lte" || op == "length" {
    guard value is Number(n, ..) &&
      n >= -9007199254740991.0 &&
      n <= 9007199254740991.0 else {
      raise Invalid("numeric assertion requires a finite exact operand")
    }
    if op == "length" {
      guard n >= 0.0 && n <= 1000000.0 && n == n.to_int().to_double() else {
        raise Invalid("length assertion requires bounded nonnegative integer")
      }
    }
  }
}

///|
fn check_model_step(step : Json, initial : Json) -> Unit raise TestError {
  exact_keys(step, [
    "id", "operationId", "parameters", "body", "negative", "status", "capture", "requires",
    "set", "assert",
  ])
  ignore(model_name(field(step, "id")))
  safe_name(text(field(step, "operationId")))
  if fields(step).contains("parameters") {
    check_object(
      field(step, "parameters"),
      "parameter overrides must be object",
    )
  }
  if fields(step).contains("negative") {
    guard field(step, "negative") is True || field(step, "negative") is False else {
      raise Invalid("negative must be boolean")
    }
  }
  if fields(step).contains("status") {
    guard field(step, "status") is Number(n, ..) &&
      n >= 100.0 &&
      n <= 599.0 &&
      n == n.to_int().to_double() else {
      raise Invalid("expected HTTP status required")
    }
  }
  for key in ["requires", "set"] {
    let data = field(step, key)
    if fields(step).contains(key) {
      check_object(data, "model state fields must be objects")
      for name in fields(data) {
        guard fields(initial).contains(name) else {
          raise Invalid("state variable must be declared in initial")
        }
        literal_model(field(data, name))
      }
    }
  }
  if fields(step).contains("capture") {
    let captures = field(step, "capture")
    check_object(captures, "capture object required")
    guard fields(captures).length() <= 16 else {
      raise Invalid("capture budget")
    }
    for name in fields(captures) {
      ignore(model_name(Json(name)))
      guard !fields(initial).contains(name) else {
        raise Invalid("capture cannot overwrite model state")
      }
      pointer_syntax(field(captures, name))
    }
  }
  if fields(step).contains("assert") {
    guard field(step, "assert") is Array(assertions) &&
      assertions.length() <= 32 else {
      raise Invalid("assertion array budget")
    }
    let names : Map[String, Bool] = Map([])
    for a in assertions {
      exact_keys(a, ["id", "pointer", "op", "expected"])
      let name = model_name(field(a, "id"))
      guard !names.contains(name) else {
        raise Invalid("duplicate assertion id")
      }
      names[name] = true
      pointer_syntax(field(a, "pointer"))
      let op = text(field(a, "op"))
      guard ["eq", "ne", "exists", "absent", "length", "gte", "lte"].contains(
        op,
      ) else {
        raise Invalid("unsupported assertion operator")
      }
      guard fields(a).contains("expected") == (op != "exists" && op != "absent") else {
        raise Invalid("assertion expected field mismatch")
      }
      if !(field(field(a, "expected"), "$from") is String(_)) {
        assertion_operand(op, field(a, "expected"))
      }
    }
  }
}

///|
pub fn model_preconditions(step : Json, bindings : Json) -> Bool {
  for key in fields(field(step, "requires")) {
    if !fields(bindings).contains(key) ||
      field(bindings, key) != field(field(step, "requires"), key) {
      return false
    }
  }
  true
}

///|
pub fn model_effects(step : Json, bindings : Json) -> Json {
  let out : Map[String, Json] = Map([])
  for key in fields(bindings) {
    out[key] = field(bindings, key)
  }
  for key in fields(field(step, "set")) {
    out[key] = field(field(step, "set"), key)
  }
  Json(out)
}

///|
pub fn validate_sequence(model : Json) -> Unit raise TestError {
  guard @utf8.encode(model.stringify()).length() <= 65536 else {
    raise Invalid("model byte budget")
  }
  exact_keys(model, ["format", "name", "initial", "steps"])
  guard field(model, "format") == 1 else {
    raise Invalid("behavior model format 1 required")
  }
  ignore(model_name(field(model, "name")))
  let initial = field(model, "initial")
  check_object(initial, "initial state object required")
  guard fields(initial).length() <= 32 else {
    raise Invalid("initial state budget")
  }
  let known : Map[String, Bool] = Map([])
  for key in fields(initial) {
    ignore(model_name(Json(key)))
    literal_model(field(initial, key))
    known[key] = true
  }
  guard field(model, "steps") is Array(steps) &&
    steps.length() > 0 &&
    steps.length() <= 64 else {
    raise Invalid("behavior requires 1..64 steps")
  }
  let names : Map[String, Bool] = Map([])
  let mut bindings = initial
  for step in steps {
    check_model_step(step, initial)
    let id = text(field(step, "id"))
    guard !names.contains(id) else { raise Invalid("duplicate step id") }
    names[id] = true
    guard model_preconditions(step, bindings) else {
      raise Invalid("unsatisfied model precondition")
    }
    model_refs(field(step, "parameters"), known, 0)
    model_refs(field(step, "body"), known, 0)
    model_refs(field(step, "assert"), known, 0)
    for key in fields(field(step, "capture")) {
      known[key] = true
    }
    guard known.length() <= 64 else { raise Invalid("model binding budget") }
    bindings = model_effects(step, bindings)
  }
}

///|
pub fn model_assertions(
  step : Json,
  body : Json,
  bindings : Json,
) -> Finding raise TestError {
  let issues : Array[Issue] = []
  for assertion in array(field(step, "assert")) {
    let pointer = text(field(assertion, "pointer"))
    let actual = Some(json_pointer(body, pointer)) catch { _ => None }
    let expected = bind_value(field(assertion, "expected"), bindings, 0)
    let op = text(field(assertion, "op"))
    assertion_operand(op, expected)
    let passed = match (op, actual) {
      ("exists", Some(_)) | ("absent", None) => true
      ("eq", Some(v)) => v == expected
      ("ne", Some(v)) => v != expected
      ("length", Some(String(v))) => Json(v.char_length()) == expected
      ("length", Some(Array(v))) => Json(v.length()) == expected
      ("gte", Some(Number(a, ..))) =>
        match expected {
          Number(b, ..) => a >= b
          _ => false
        }
      ("lte", Some(Number(a, ..))) =>
        match expected {
          Number(b, ..) => a <= b
          _ => false
        }
      _ => false
    }
    if !passed {
      issues.push({
        code: "behavior_assertion",
        pointer: text(field(assertion, "id")),
        message: "cross-step model invariant failed",
      })
    }
  }
  {
    passed: issues.is_empty(),
    fingerprint: if issues.is_empty() {
      ""
    } else {
      text(field(step, "id")) + ":" + issues[0].code + ":" + issues[0].pointer
    },
    issues,
  }
}

///|
pub fn sequence_candidates(model : Json) -> Array[Json] raise TestError {
  validate_sequence(model)
  let steps = array(field(model, "steps"))
  let output : Array[Json] = []
  let mut width = steps.length() / 2
  while width >= 1 {
    for start = 0; start + width <= steps.length(); start = start + width {
      let smaller = []
      for i = 0; i < steps.length(); i = i + 1 {
        if i < start || i >= start + width {
          smaller.push(steps[i])
        }
      }
      if smaller.is_empty() {
        continue
      }
      let candidate : Json = {
        "format": 1,
        "name": field(model, "name"),
        "initial": field(model, "initial"),
        "steps": Json(smaller),
      }
      let valid = try {
        validate_sequence(candidate)
        true
      } catch {
        _ => false
      }
      if valid {
        output.push(candidate)
      }
      if output.length() >= 128 {
        return output
      }
    }
    width = width / 2
  }
  output
}

///|
pub fn generate_sequence(
  model : Json,
  seed : Int32,
  limit : Int32,
) -> Json raise TestError {
  guard @utf8.encode(model.stringify()).length() <= 65536 else {
    raise Invalid("model byte budget")
  }
  guard seed >= 0 && seed <= 1000000 && limit >= 1 && limit <= 64 else {
    raise Invalid("generation budget")
  }
  exact_keys(model, ["format", "name", "initial", "transitions"])
  guard field(model, "format") == 1 else {
    raise Invalid("model format 1 required")
  }
  ignore(model_name(field(model, "name")))
  let initial = field(model, "initial")
  check_object(initial, "initial model state required")
  guard fields(initial).length() <= 32 else {
    raise Invalid("initial state budget")
  }
  let known : Map[String, Bool] = Map([])
  for key in fields(initial) {
    ignore(model_name(Json(key)))
    literal_model(field(initial, key))
    known[key] = true
  }
  guard field(model, "transitions") is Array(transitions) &&
    transitions.length() > 0 &&
    transitions.length() <= 64 else {
    raise Invalid("transition budget")
  }
  let visits : Map[String, Int32] = Map([])
  for t in transitions {
    check_model_step(t, initial)
    let id = text(field(t, "id"))
    guard id.length() <= 48 && !visits.contains(id) else {
      raise Invalid("duplicate or oversized transition id")
    }
    visits[id] = 0
  }
  let declared = known.copy()
  for t in transitions {
    for name in fields(field(t, "capture")) {
      declared[name] = true
    }
  }
  guard declared.length() <= 64 else {
    raise Invalid("declared capture budget")
  }
  for t in transitions {
    model_refs(field(t, "parameters"), declared, 0)
    model_refs(field(t, "body"), declared, 0)
    model_refs(field(t, "assert"), declared, 0)
  }
  let steps : Array[Json] = []
  let mut bindings = initial
  let mut rng = seed.reinterpret_as_uint()
  let mut reason = "step_budget"
  for _i = 0; _i < limit; _i = _i + 1 {
    let enabled : Array[Json] = []
    let mut least = 1000000
    for t in transitions {
      let references = try {
        model_refs(field(t, "parameters"), known, 0)
        model_refs(field(t, "body"), known, 0)
        model_refs(field(t, "assert"), known, 0)
        true
      } catch {
        _ => false
      }
      if model_preconditions(t, bindings) && references {
        let count = visits[text(field(t, "id"))]
        if count < least {
          enabled.clear()
          least = count
        }
        if count == least {
          enabled.push(t)
        }
      }
    }
    if enabled.is_empty() {
      reason = "no_enabled_transition"
      break
    }
    rng = rng * 1664525U + 1013904223U
    let chosen = enabled[(rng % enabled.length().reinterpret_as_uint()).reinterpret_as_int()]
    let id = text(field(chosen, "id"))
    visits[id] = visits[id] + 1
    let copy : Map[String, Json] = Map([])
    for key in fields(chosen) {
      copy[key] = field(chosen, key)
    }
    copy["id"] = Json(id + "-" + steps.length().to_string())
    steps.push(Json(copy))
    bindings = model_effects(chosen, bindings)
    for key in fields(field(chosen, "capture")) {
      known[key] = true
    }
    guard known.length() <= 64 else { raise Invalid("binding budget") }
  }
  guard !steps.is_empty() else {
    raise Invalid("model has no runnable transition")
  }
  let trace : Json = {
    "format": 1,
    "name": field(model, "name"),
    "initial": initial,
    "steps": Json(steps),
  }
  validate_sequence(trace)
  let covered = fields(Json(visits)).filter(k => visits[k] > 0)
  {
    "trace": trace,
    "generation_reason": Json(reason),
    "covered_transitions": Json(covered),
    "total_transitions": transitions.length(),
  }
}

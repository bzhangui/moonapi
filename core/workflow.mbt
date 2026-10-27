///|
/// Portable metadata IR. Payloads stay opaque in the host adapter so int64 and
/// decimal lexemes are never projected through Json's floating-point values.
pub fn workflow_check(steps : Json) -> Json raise TestError {
  guard steps is Array(entries) &&
    entries.length() > 0 &&
    entries.length() <= 64 else {
    raise Invalid("workflow step budget")
  }
  let seen : Map[String, Bool] = Map([])
  let states : Map[String, Bool] = Map([])
  for step in entries {
    for key in ["needs", "requires", "effects"] {
      let value = field(step, key)
      guard value is Null || (value is Array(items) && items.length() <= 64) else {
        raise Invalid("workflow metadata array required")
      }
    }
    let id = text(field(step, "id"))
    safe_name(id)
    guard !seen.contains(id) else { raise Invalid("duplicate workflow step") }
    for dependency in array(field(step, "needs")) {
      guard dependency is String(name) && seen.contains(name) else {
        raise Invalid("workflow dependency must precede consumer")
      }
    }
    for state in array(field(step, "requires")) {
      guard state is String(name) && states.contains(name) else {
        raise Invalid("workflow state precondition")
      }
    }
    for state in array(field(step, "effects")) {
      guard state is String(name) else { raise Invalid("workflow state name") }
      safe_name(name)
      states[name] = true
    }
    seen[id] = true
  }
  { "valid": true, "steps": Json(entries.length()) }
}

///|
/// Remove a step and its transitive data/state consumers, never dangling refs.
pub fn workflow_remove(steps : Json, removed : String) -> Json raise TestError {
  ignore(workflow_check(steps))
  let gone : Map[String, Bool] = Map([])
  gone[removed] = true
  let retained : Array[Json] = []
  let states : Map[String, Bool] = Map([])
  for step in array(steps) {
    let id = text(field(step, "id"))
    let mut discard = gone.contains(id)
    for dependency in array(field(step, "needs")) {
      if gone.contains(text(dependency)) {
        discard = true
      }
    }
    for state in array(field(step, "requires")) {
      if !states.contains(text(state)) {
        discard = true
      }
    }
    if discard {
      gone[id] = true
    } else {
      retained.push(Json(id))
      for state in array(field(step, "effects")) {
        states[text(state)] = true
      }
    }
  }
  { "retained": Json(retained) }
}

///|
pub fn workflow_assert(kind : String, observed : Bool) -> Json raise TestError {
  guard ["equal", "not_equal", "exists", "absent", "status", "count"].contains(
    kind,
  ) else {
    raise Invalid("workflow assertion kind")
  }
  {
    "passed": Json(observed),
    "code": Json(if observed { "" } else { "business_" + kind }),
  }
}

///|
/// Only reproducible defects can drive shrinking. Access, transport and budgets
/// cannot be promoted to business findings by a host adapter.
pub fn workflow_category(code : String) -> String {
  if code == "" {
    "passed"
  } else if code == "transport" {
    "transport"
  } else if code == "access_or_rate_limit" || code == "redirect_not_followed" {
    "inconclusive"
  } else if code.has_prefix("unsupported_") {
    "unsupported"
  } else if code.contains("budget") || code == "total_deadline" {
    "budget"
  } else if code.has_prefix("business_") ||
    [
      "server_error", "response_contract", "negative_accepted", "positive_rejected",
      "callback_contract_or_timeout",
    ].contains(code) {
    "defect"
  } else {
    "blocked"
  }
}

///|
/// Bounded linearizability checker for a declared integer register/CAS model.
/// It proves only the supplied history, not arbitrary API consistency.
pub fn register_history(
  initial : Int32,
  history : Json,
) -> Json raise TestError {
  guard history is Array(operations) &&
    operations.length() > 0 &&
    operations.length() <= 8 else {
    raise Invalid("history budget")
  }
  guard initial >= -1000000 && initial <= 1000000 else {
    raise Invalid("register value budget")
  }
  for op in operations {
    let kind = text(field(op, "kind"))
    if kind == "write" || kind == "cas" {
      guard field(op, "value") is Number(_) else {
        raise Invalid("history value required")
      }
    }
    if kind == "cas" {
      guard field(op, "expected") is Number(_) else {
        raise Invalid("history expectation required")
      }
    }
    for key in ["observed", "start", "end"] {
      guard field(op, key) is Number(_) else {
        raise Invalid("history observation required")
      }
    }
    guard field(op, "success") is True || field(op, "success") is False else {
      raise Invalid("history result required")
    }
    guard ["read", "write", "cas"].contains(text(field(op, "kind"))) else {
      raise Invalid("history operation")
    }
    for key in ["value", "expected", "observed", "start", "end"] {
      let v = field(op, key)
      guard v is Null ||
        (
          v is Number(n, ..) &&
          n >= -1000000.0 &&
          n <= 1000000.0 &&
          n == n.trunc()
        ) else {
        raise Invalid("history integer required")
      }
    }
    guard numeric(field(op, "start"), 0.0) < numeric(field(op, "end"), 0.0) else {
      raise Invalid("history clock order")
    }
  }
  let used : Array[Bool] = Array::make(operations.length(), false)
  let mut visited = 0
  fn search(state : Int32, depth : Int32) -> Bool raise TestError {
    visited += 1
    guard visited <= 100000 else { raise Invalid("history search budget") }
    if depth == operations.length() {
      return true
    }
    for i = 0; i < operations.length(); i = i + 1 {
      if used[i] {
        continue
      }
      let op = operations[i]
      let mut enabled = true
      for j = 0; j < operations.length(); j = j + 1 {
        if !used[j] &&
          j != i &&
          numeric(field(operations[j], "end"), 0.0) <=
          numeric(field(op, "start"), 0.0) {
          enabled = false
        }
      }
      if !enabled {
        continue
      }
      let kind = text(field(op, "kind"))
      let expected = numeric(field(op, "expected"), 0.0).to_int()
      let value = numeric(field(op, "value"), 0.0).to_int()
      let observed = numeric(field(op, "observed"), 0.0).to_int()
      let success = field(op, "success") is True
      let valid = if kind == "read" {
        success && observed == state
      } else if kind == "write" {
        success && observed == value
      } else {
        success == (state == expected) &&
        observed == (if success { value } else { state })
      }
      if valid {
        used[i] = true
        let next = if kind == "write" || (kind == "cas" && success) {
          value
        } else {
          state
        }
        if search(next, depth + 1) {
          return true
        }
        used[i] = false
      }
    }
    false
  }
  let result = search(initial, 0)
  {
    "linearizable": Json(result),
    "histories_checked": Json(visited),
    "bounded_operations": Json(operations.length()),
    "general_api_proof": false,
  }
}

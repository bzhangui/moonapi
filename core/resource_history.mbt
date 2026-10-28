///|
/// A bounded sequential specification for counters and stock reservations.
/// Only the supplied history is checked; no universal consistency claim.
pub fn resource_history(
  model : String,
  initial : Int32,
  capacity : Int32,
  history : Json,
) -> Json raise TestError {
  guard ["counter", "reservation"].contains(model) &&
    capacity >= 0 &&
    capacity <= 1000000 &&
    initial >= 0 &&
    initial <= capacity else {
    raise Invalid("resource history model")
  }
  guard history is Array(ops) && ops.length() > 0 && ops.length() <= 8 else {
    raise Invalid("resource history budget")
  }
  for op in ops {
    let kind = text(field(op, "kind"))
    guard (if model == "counter" {
      ["read", "add"]
    } else {
      ["read", "reserve", "release"]
    }).contains(kind) else {
      raise Invalid("resource history kind")
    }
    guard field(op, "success") is True || field(op, "success") is False else {
      raise Invalid("resource history success")
    }
    for key in ["amount", "observed", "start", "end"] {
      guard field(op, key) is Number(n, ..) &&
        n >= -1000000.0 &&
        n <= 1000000.0 &&
        n == n.trunc() else {
        raise Invalid("resource history integer")
      }
    }
    guard numeric(field(op, "start"), 0.0) >= 0.0 &&
      numeric(field(op, "start"), 0.0) < numeric(field(op, "end"), 0.0) &&
      (
        kind == "read" ||
        model == "counter" ||
        numeric(field(op, "amount"), 0.0) > 0.0
      ) else {
      raise Invalid("resource history time or amount")
    }
  }
  let used : Array[Bool] = Array::make(ops.length(), false)
  let mut visited = 0
  fn search(state : Int32, depth : Int32) -> Bool raise TestError {
    visited += 1
    guard visited <= 100000 else {
      raise Invalid("resource history search budget")
    }
    if depth == ops.length() {
      return true
    }
    for i = 0; i < ops.length(); i = i + 1 {
      if used[i] {
        continue
      }
      let op = ops[i]
      let mut enabled = true
      for j = 0; j < ops.length(); j = j + 1 {
        if j != i &&
          !used[j] &&
          numeric(field(ops[j], "end"), 0.0) <= numeric(field(op, "start"), 0.0) {
          enabled = false
        }
      }
      if !enabled {
        continue
      }
      let kind = text(field(op, "kind"))
      let amount = numeric(field(op, "amount"), 0.0).to_int()
      let changed = if kind == "read" {
        state
      } else if kind == "reserve" {
        state - amount
      } else {
        state + amount
      }
      let accepted = kind == "read" || (changed >= 0 && changed <= capacity)
      let next = if accepted { changed } else { state }
      if (field(op, "success") is True) == accepted &&
        numeric(field(op, "observed"), -1.0).to_int() == next {
        used[i] = true
        if search(next, depth + 1) {
          return true
        }
        used[i] = false
      }
    }
    false
  }
  let valid = search(initial, 0)
  {
    "linearizable": Json(valid),
    "model": Json(model),
    "histories_checked": Json(visited),
    "bounded_operations": Json(ops.length()),
    "general_api_proof": false,
  }
}

///|
/// Choose a least-used, already schema-validated response sample. The host owns
/// private values and scope checks; the portable policy sees bounded counts only.
pub fn feedback_choice(counts : Json, seed : Int32) -> Json raise TestError {
  guard seed >= 0 &&
    seed <= 1000000 &&
    counts is Array(entries) &&
    entries.length() > 0 &&
    entries.length() <= 16 else {
    raise Invalid("feedback budget")
  }
  let available : Array[Int32] = []
  let mut least = 1000001.0
  for i = 0; i < entries.length(); i = i + 1 {
    guard entries[i] is Number(n, ..) &&
      n >= 0.0 &&
      n <= 1000000.0 &&
      n == n.trunc() else {
      raise Invalid("feedback use count")
    }
    if n < least {
      available.clear()
      least = n
    }
    if n == least {
      available.push(i)
    }
  }
  let rng = seed.reinterpret_as_uint() * 1664525U + 1013904223U
  {
    "index": Json(
      available[(rng % available.length().reinterpret_as_uint()).reinterpret_as_int()],
    ),
    "complete_state_space": false,
  }
}

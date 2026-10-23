///|
/// Portable policy for standards-adapter execution; no shared host RNG.
pub fn standard_schedule(
  catalog : Json,
  seed : Int32,
  limit : Int32,
) -> Json raise TestError {
  guard seed >= 0 && seed <= 1000000 && limit >= 1 && limit <= 256 else {
    raise Invalid("invalid standard plan budget")
  }
  guard catalog is Array(entries) && entries.length() <= 256 else {
    raise Invalid("invalid standard catalog")
  }
  let selected : Array[Json] = []
  let seen : Map[String, Bool] = Map([])
  for entry in entries {
    let id = text(field(entry, "id"))
    safe_name(id)
    guard !seen.contains(id) else {
      raise Invalid("duplicate catalog operation")
    }
    seen[id] = true
    guard field(entry, "count") is Number(n, ..) &&
      n >= 0.0 &&
      n <= 128.0 &&
      n == n.trunc() else {
      raise Invalid("invalid variant count")
    }
  }
  // Give every operation a chance before allocating a second variant.
  if !entries.is_empty() {
    for round = 0; round < 128; round = round + 1 {
      for offset = 0; offset < entries.length(); offset = offset + 1 {
        let entry = entries[(offset + seed % entries.length()) %
          entries.length()]
        if round.to_double() < numeric(field(entry, "count"), 0.0) &&
          selected.length() < limit {
          selected.push({ "operation_id": field(entry, "id"), "variant": round })
        }
      }
    }
  }
  let mut total = 0
  for entry in entries {
    total += numeric(field(entry, "count"), 0.0).to_int()
  }
  {
    "selected": Json(selected),
    "planned": Json(selected.length()),
    "available": Json(total),
    "truncated": Json(total > selected.length()),
  }
}

///|
/// A schema-valid 4xx is not success for a positive generated test.
pub fn standard_oracle(
  status : Int32,
  negative : Bool,
  contract_valid : Bool,
) -> Json raise TestError {
  guard status >= 0 && status <= 599 else {
    raise Invalid("invalid HTTP status")
  }
  let code = if status < 100 {
    "transport"
  } else if status >= 500 {
    "server_error"
  } else if status == 401 || status == 403 || status == 429 {
    "access_or_rate_limit"
  } else if !contract_valid {
    "response_contract"
  } else if negative && !(status >= 400 && status < 500) {
    "negative_accepted"
  } else if !negative && status >= 400 {
    "positive_rejected"
  } else if status >= 300 && status < 400 {
    "redirect_not_followed"
  } else {
    ""
  }
  {
    "passed": Json(code == ""),
    "code": Json(code),
    "inconclusive": Json(code == "access_or_rate_limit"),
    "fingerprint": Json(if code == "" { "" } else { "\{status}:" + code }),
  }
}

///|
/// A sampled green run cannot establish full-standard compatibility.
pub fn standard_verdict(
  planned : Int32,
  executed : Int32,
  failed : Int32,
  blocked : Int32,
  truncated : Bool,
) -> Json raise TestError {
  guard planned >= 0 &&
    executed >= 0 &&
    failed >= 0 &&
    blocked >= 0 &&
    executed <= planned &&
    failed <= executed else {
    raise Invalid("invalid standard execution counts")
  }
  let complete = planned > 0 &&
    planned == executed &&
    failed == 0 &&
    blocked == 0 &&
    !truncated
  {
    "complete": Json(complete),
    "passed": Json(complete),
    "full_openapi_support": false,
  }
}

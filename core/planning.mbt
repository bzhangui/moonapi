///|
/// Exact lattice candidate generation. The host supplies authorized, normalized
/// schema bounds; the result must still pass the complete schema validator.
pub fn numeric_candidate(input : Json) -> Json raise TestError {
  for key in ["integer", "exclusive_lower", "exclusive_upper"] {
    guard field(input, key) is Null ||
      field(input, key) is True ||
      field(input, key) is False else {
      raise Invalid("candidate boolean option")
    }
  }
  let (coefficient, exponent) = decimal_parts(field(input, "step"))
  let mut a = coefficient
  let mut f = exponent
  guard a > 0 else { raise Invalid("candidate positive step") }
  let offset = numeric(field(input, "offset"), -1.0)
  guard offset >= 0.0 && offset <= 31.0 && offset == offset.trunc() else {
    raise Invalid("candidate offset budget")
  }
  if field(input, "integer") is True && f < 0 {
    let mut x = a
    let mut y = scale_decimal(@bigint.BigInt::from_int(1), -f)
    while y != 0 {
      let z = x % y
      x = y
      y = z
    }
    a = a / x
    f = 0
  }
  let lower = field(input, "lower")
  let upper = field(input, "upper")
  let up = lower != null || upper is Null
  let (x, e) = if lower != null {
    decimal_parts(lower)
  } else if upper != null {
    decimal_parts(upper)
  } else {
    (@bigint.BigInt::from_int(0), 0)
  }
  let z = if e < f { e } else { f }
  let value = scale_decimal(x, e - z)
  let unit = scale_decimal(a, f - z)
  let mut q = value / unit
  if (up && value % unit > 0) || (!up && value % unit < 0) {
    q = q + (if up { 1 } else { -1 })
  }
  if value % unit == 0 &&
    (
      (up && field(input, "exclusive_lower") is True) ||
      (!up && field(input, "exclusive_upper") is True)
    ) {
    q = q + (if up { 1 } else { -1 })
  }
  q = q + @bigint.BigInt::from_int(offset.to_int()) * (if up { 1 } else { -1 })
  { "coefficient": Json((q * unit).to_string()), "exponent": Json(z) }
}

///|
/// Versioned, metadata-only dependency IR. Edges are suggestions, never a grant
/// to send requests or delete resources. Cycles remain visible, not discarded.
pub fn dependency_ir(catalog : Json, edges : Json) -> Json raise TestError {
  guard catalog is Array(entries) && entries.length() <= 256 else {
    raise Invalid("IR operation budget")
  }
  guard edges is Array(links) && links.length() <= 1024 else {
    raise Invalid("IR edge budget")
  }
  let known : Map[String, Bool] = Map([])
  for entry in entries {
    let id = text(field(entry, "id"))
    guard id.length() > 0 && id.length() <= 256 && !known.contains(id) else {
      raise Invalid("IR operation identity")
    }
    known[id] = true
  }
  let distinct : Map[String, Bool] = Map([])
  let normalized : Array[Json] = []
  for edge in links {
    let from = text(field(edge, "from"))
    let to = text(field(edge, "to"))
    let kind = text(field(edge, "kind"))
    guard known.contains(from) &&
      known.contains(to) &&
      (kind == "link" || kind == "shape") else {
      raise Invalid("IR edge identity")
    }
    // Length prefixes avoid ambiguous concatenated IDs.
    let key = from.length().to_string() + ":" + from + to
    if !distinct.contains(key) {
      distinct[key] = true
      normalized.push({ "from": Json(from), "to": Json(to), "kind": Json(kind) })
    }
  }
  let done : Map[String, Bool] = Map([])
  let degree : Map[String, Int32] = Map([])
  let outgoing : Map[String, Array[String]] = Map([])
  for entry in entries {
    let id = text(field(entry, "id"))
    degree[id] = 0
    outgoing[id] = []
  }
  for edge in normalized {
    let from = text(field(edge, "from"))
    let to = text(field(edge, "to"))
    degree[to] += 1
    outgoing[from].push(to)
  }
  let layers : Array[Json] = []
  for _round = 0; _round < entries.length(); _round = _round + 1 {
    let ready : Array[Json] = []
    for entry in entries {
      let id = text(field(entry, "id"))
      if done.contains(id) {
        continue
      }
      if degree[id] == 0 {
        ready.push(Json(id))
      }
    }
    if ready.is_empty() {
      break
    }
    for id in ready {
      done[text(id)] = true
      for target in outgoing[text(id)] {
        degree[target] -= 1
      }
    }
    layers.push(Json(ready))
  }
  let unresolved : Array[Json] = []
  for entry in entries {
    let id = text(field(entry, "id"))
    if !done.contains(id) {
      unresolved.push(Json(id))
    }
  }
  {
    "format": 1,
    "layers": Json(layers),
    "edges": Json(normalized),
    "unresolved": Json(unresolved),
    "acyclic": Json(unresolved.is_empty()),
    "execution_authorized": false,
    "business_model_inferred": false,
  }
}

///|
/// Prioritize least-observed operations while retaining round-robin fairness.
/// Counts are campaign metadata only, not resource IDs or request bodies.
pub fn coverage_schedule(
  catalog : Json,
  seed : Int32,
  limit : Int32,
) -> Json raise TestError {
  guard seed >= 0 && seed <= 1000000 && limit >= 1 && limit <= 256 else {
    raise Invalid("coverage budget")
  }
  guard catalog is Array(entries) && entries.length() <= 256 else {
    raise Invalid("coverage catalog")
  }
  let seen : Map[String, Bool] = Map([])
  let used : Array[Int32] = []
  let mut total = 0
  for entry in entries {
    let id = text(field(entry, "id"))
    let count = numeric(field(entry, "count"), -1.0)
    let visits = numeric(field(entry, "visits"), 0.0)
    guard id.length() > 0 &&
      id.length() <= 256 &&
      !seen.contains(id) &&
      count >= 0.0 &&
      count <= 128.0 &&
      count == count.trunc() &&
      visits >= 0.0 &&
      visits <= 1000000.0 &&
      visits == visits.trunc() else {
      raise Invalid("coverage entry")
    }
    seen[id] = true
    used.push(0)
    total += count.to_int()
  }
  let selected : Array[Json] = []
  for _round = 0; _round < limit; _round = _round + 1 {
    let mut best = -1
    let mut least_round = 129
    let mut least_visits = 1000001.0
    for k = 0; k < entries.length(); k = k + 1 {
      let i = (k + seed % entries.length()) % entries.length()
      let entry = entries[i]
      let visits = numeric(field(entry, "visits"), 0.0)
      if used[i].to_double() < numeric(field(entry, "count"), 0.0) &&
        (
          used[i] < least_round ||
          (used[i] == least_round && visits < least_visits)
        ) {
        best = i
        least_round = used[i]
        least_visits = visits
      }
    }
    if best < 0 {
      break
    }
    selected.push({
      "operation_id": field(entries[best], "id"),
      "variant": Json(used[best]),
    })
    used[best] += 1
  }
  {
    "selected": Json(selected),
    "available": Json(total),
    "truncated": Json(total > selected.length()),
    "exhaustive_business_coverage": false,
  }
}

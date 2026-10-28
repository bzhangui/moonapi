///|
/// State values are opaque resource aliases, not actual server IDs or numbers.
pub fn resource_state_check(
  initial : Json,
  steps : Json,
) -> Json raise TestError {
  guard initial is Object(_) && fields(initial).length() <= 64 else {
    raise Invalid("resource initial state")
  }
  let mut state = initial
  for key in fields(initial) {
    safe_name(key)
    safe_name(text(field(initial, key)))
  }
  guard steps is Array(entries) && entries.length() <= 64 else {
    raise Invalid("resource step budget")
  }
  for step in entries {
    let required = field(step, "requires_state")
    let changed = field(step, "set_state")
    for value in [required, changed] {
      guard value is Null ||
        (value is Object(_) && fields(value).length() <= 64) else {
        raise Invalid("resource state map")
      }
      for key in fields(value) {
        safe_name(key)
        safe_name(text(field(value, key)))
      }
    }
    guard model_preconditions({ "requires": required }, state) else {
      raise Invalid("resource state precondition")
    }
    state = model_effects({ "set": changed }, state)
  }
  { "valid": true, "state": state }
}

///|
/// Fair seeded bounded exploration. max_visits is explicit per transition;
/// adapters must not silently repeat non-idempotent writes.
pub fn resource_graph_plan(
  graph : Json,
  seed : Int32,
  limit : Int32,
) -> Json raise TestError {
  guard seed >= 0 && seed <= 1000000 && limit > 0 && limit <= 64 else {
    raise Invalid("graph budget")
  }
  let initial = field(graph, "initial_state")
  ignore(resource_state_check(initial, []))
  guard field(graph, "transitions") is Array(transitions) &&
    transitions.length() > 0 &&
    transitions.length() <= 64 else {
    raise Invalid("graph transitions")
  }
  let visits : Map[String, Int32] = Map([])
  for t in transitions {
    let id = text(field(t, "id"))
    safe_name(id)
    guard !visits.contains(id) else {
      raise Invalid("graph duplicate transition")
    }
    visits[id] = 0
    let campaign = numeric(field(t, "campaign_visits"), 0.0)
    guard campaign >= 0.0 && campaign <= 32.0 && campaign == campaign.trunc() else {
      raise Invalid("graph campaign coverage budget")
    }
    let maximum = numeric(field(t, "max_visits"), 1.0)
    guard maximum >= 1.0 && maximum <= 8.0 && maximum == maximum.trunc() else {
      raise Invalid("graph visit budget")
    }
    for state in [field(t, "requires_state"), field(t, "set_state")] {
      guard state is Null ||
        (state is Object(_) && fields(state).length() <= 64) else {
        raise Invalid("graph state map")
      }
      for key in fields(state) {
        safe_name(key)
        safe_name(text(field(state, key)))
      }
    }
  }
  for t in transitions {
    let needs = field(t, "needs")
    guard needs is Null || (needs is Array(items) && items.length() <= 64) else {
      raise Invalid("graph dependencies")
    }
    for dependency in array(needs) {
      guard visits.contains(text(dependency)) else {
        raise Invalid("graph unknown dependency")
      }
    }
  }
  let chosen : Array[Json] = []
  let mut state = initial
  let mut rng = seed.reinterpret_as_uint()
  for _i = 0; _i < limit; _i = _i + 1 {
    let available : Array[Json] = []
    let mut least = 1000000
    let mut campaign_least = 1000000.0
    for t in transitions {
      let id = text(field(t, "id"))
      let mut dependencies = true
      for dependency in array(field(t, "needs")) {
        if !visits.contains(text(dependency)) || visits[text(dependency)] == 0 {
          dependencies = false
        }
      }
      if dependencies &&
        visits[id].to_double() < numeric(field(t, "max_visits"), 1.0) &&
        model_preconditions({ "requires": field(t, "requires_state") }, state) {
        if visits[id] < least {
          available.clear()
          least = visits[id]
          campaign_least = 1000000.0
        }
        if visits[id] == least {
          let campaign = numeric(field(t, "campaign_visits"), 0.0)
          if campaign < campaign_least {
            available.clear()
            campaign_least = campaign
          }
          if campaign == campaign_least {
            available.push(t)
          }
        }
      }
    }
    if available.is_empty() {
      break
    }
    rng = rng * 1664525U + 1013904223U
    let t = available[(rng % available.length().reinterpret_as_uint()).reinterpret_as_int()]
    ignore(resource_state_check(state, [t]))
    let id = text(field(t, "id"))
    visits[id] = visits[id] + 1
    chosen.push(Json(id))
    state = model_effects({ "set": field(t, "set_state") }, state)
  }
  let covered = fields(Json(visits)).filter(id => visits[id] > 0)
  {
    "selected": Json(chosen),
    "covered": Json(covered),
    "total": Json(transitions.length()),
    "state": state,
    "all_transitions_covered": Json(covered.length() == transitions.length()),
  }
}

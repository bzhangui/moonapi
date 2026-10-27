///|
/// Portable lifecycle policy. Dispatching/sent without a final receipt is always
/// ambiguous; no host may interpret a missing response as permission to replay.
pub fn execution_transition(from : String, to : String) -> Json raise TestError {
  let allowed = match from {
    "" => ["prepared"]
    "prepared" => ["dispatching", "blocked"]
    "dispatching" => ["sent", "responded", "unknown"]
    "sent" => ["responded", "unknown"]
    "responded" => ["completed", "failed", "unknown"]
    _ => []
  }
  guard allowed.contains(to) else {
    raise Invalid("invalid execution transition")
  }
  { "accepted": true, "automatic_replay": false }
}

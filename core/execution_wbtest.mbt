///|
test "execution lifecycle never authorizes replay of ambiguous writes" {
  for
    (from, to) in [
      ("", "prepared"),
      ("prepared", "dispatching"),
      ("dispatching", "sent"),
      ("sent", "responded"),
      ("responded", "completed"),
      ("sent", "unknown"),
      ("prepared", "blocked"),
      ("dispatching", "responded"),
      ("responded", "failed"),
      ("dispatching", "unknown"),
      ("responded", "unknown"),
    ] {
    assert_eq(
      field(execution_transition(from, to), "automatic_replay"),
      Json(false),
    )
  }
  for
    (from, to) in [
      ("", "completed"),
      ("unknown", "dispatching"),
      ("completed", "sent"),
    ] {
    let rejected = try {
      ignore(execution_transition(from, to))
      false
    } catch {
      _ => true
    }
    assert_eq(rejected, true)
  }
}

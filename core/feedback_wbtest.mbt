///|
test "response feedback prefers unseen candidates and rejects invalid counts" {
  assert_eq(field(feedback_choice([8, 0, 2], 42), "index"), Json(1))
  assert_eq(feedback_choice([1, 1, 1], 73), feedback_choice([1, 1, 1], 73))
  let rejected = try {
    ignore(feedback_choice([-1], 42))
    false
  } catch {
    _ => true
  }
  assert_eq(rejected, true)
}

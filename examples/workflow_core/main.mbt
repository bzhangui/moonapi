///|
fn main raise {
  let steps : Json = [
    { "id": "create", "needs": [], "requires": [], "effects": ["created"] },
    {
      "id": "read",
      "needs": ["create"],
      "requires": ["created"],
      "effects": [],
    },
  ]
  assert_eq(@engine.field(@engine.workflow_check(steps), "valid"), Json(true))
  let empty : Json = []
  assert_eq(
    @engine.field(@engine.workflow_remove(steps, "create"), "retained"),
    empty,
  )
  assert_eq(@engine.workflow_category("transport"), "transport")
  println("portable standard workflow policy consumer passed")
}

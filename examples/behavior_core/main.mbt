///|
fn main {
  try {
    let step : Json = {
      "id": "readback",
      "operationId": "health",
      "assert": [
        { "id": "healthy", "pointer": "/ok", "op": "eq", "expected": true },
      ],
    }
    let trace : Json = {
      "format": 1,
      "name": "portable_model",
      "initial": {},
      "steps": [step],
    }
    @engine.validate_sequence(trace)
    assert_true(@engine.model_assertions(step, { "ok": true }, {}).passed)
    assert_true(!@engine.model_assertions(step, { "ok": false }, {}).passed)
    println("portable behavior core verified")
  } catch {
    _ => abort("behavior core example failed")
  }
}

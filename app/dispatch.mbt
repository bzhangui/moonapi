///|
fn command(input : String) -> Json raise {
  let arguments = @engine.bounded_json(input)
  let action = @engine.text(@engine.field(arguments, "action"))
  match action {
    "workflow-check" =>
      return @engine.workflow_check(@engine.field(arguments, "steps"))
    "workflow-remove" =>
      return @engine.workflow_remove(
        @engine.field(arguments, "steps"),
        @engine.text(@engine.field(arguments, "removed")),
      )
    "workflow-assert" =>
      return @engine.workflow_assert(
        @engine.text(@engine.field(arguments, "kind")),
        @engine.field(arguments, "observed") is True,
      )
    "workflow-category" =>
      return Json(
        @engine.workflow_category(
          @engine.text(@engine.field(arguments, "code")),
        ),
      )
    "standard-expression" =>
      return @engine.standard_expression(
        @engine.text(@engine.field(arguments, "expression")),
      )
    "standard-schedule" => {
      let seed : Int32 = @json.from_json(@engine.field(arguments, "seed"))
      let limit : Int32 = @json.from_json(@engine.field(arguments, "limit"))
      return @engine.standard_schedule(
        @engine.field(arguments, "catalog"),
        seed,
        limit,
      )
    }
    "standard-oracle" => {
      let status : Int32 = @json.from_json(@engine.field(arguments, "status"))
      return @engine.standard_oracle(
        status,
        @engine.field(arguments, "negative") is True,
        @engine.field(arguments, "contract_valid") is True,
      )
    }
    "standard-verdict" => {
      let planned : Int32 = @json.from_json(@engine.field(arguments, "planned"))
      let executed : Int32 = @json.from_json(
        @engine.field(arguments, "executed"),
      )
      let failed : Int32 = @json.from_json(@engine.field(arguments, "failed"))
      let blocked : Int32 = @json.from_json(@engine.field(arguments, "blocked"))
      return @engine.standard_verdict(
        planned,
        executed,
        failed,
        blocked,
        @engine.field(arguments, "truncated") is True,
      )
    }
    "sequence-generate" => {
      let seed : Int32 = @json.from_json(@engine.field(arguments, "seed"))
      let limit : Int32 = @json.from_json(@engine.field(arguments, "limit"))
      return @engine.generate_sequence(
        @engine.field(arguments, "model"),
        seed,
        limit,
      )
    }
    "sequence-check" => {
      @engine.validate_sequence(@engine.field(arguments, "model"))
      return { "valid": true }
    }
    "sequence-candidates" =>
      return {
        "candidates": Json(
          @engine.sequence_candidates(@engine.field(arguments, "model")),
        ),
      }
    "model-preconditions" =>
      return {
        "enabled": @engine.model_preconditions(
          @engine.field(arguments, "step"),
          @engine.field(arguments, "bindings"),
        ),
      }
    "model-effects" =>
      return {
        "bindings": @engine.model_effects(
          @engine.field(arguments, "step"),
          @engine.field(arguments, "bindings"),
        ),
      }
    "model-assert" =>
      return {
        "finding": Json(
          @engine.model_assertions(
            @engine.field(arguments, "step"),
            @engine.field(arguments, "body"),
            @engine.field(arguments, "bindings"),
          ),
        ),
      }
    _ => ()
  }
  let spec = @engine.parse_openapi(
    @engine.text(@engine.field(arguments, "source")),
  )
  match action {
    "crud-plan" =>
      @engine.crud_plan(
        spec,
        @engine.text(@engine.field(arguments, "collection")),
        @engine.text(@engine.field(arguments, "field")),
        @engine.text(@engine.field(arguments, "marker")),
        @engine.text(@engine.field(arguments, "changed")),
      )
    "plan" => {
      let seed = match @engine.field(arguments, "seed") {
        Number(n, ..) => {
          guard n >= 0.0 && n <= 1000000.0 && n == n.to_int().to_double() else {
            raise @engine.Invalid("invalid seed")
          }
          n.to_int()
        }
        _ => 42
      }
      let limit = match @engine.field(arguments, "limit") {
        Number(n, ..) => {
          guard n >= 1.0 && n <= 256.0 && n == n.to_int().to_double() else {
            raise @engine.Invalid("invalid case limit")
          }
          n.to_int()
        }
        _ => 64
      }
      {
        "cases": Json(@engine.plan(spec, seed~, limit~)),
        "operations": Json(spec.operations),
      }
    }
    "scenario" => {
      let seed = match @engine.field(arguments, "seed") {
        Number(n, ..) => {
          guard n >= 0.0 && n <= 1000000.0 && n == n.to_int().to_double() else {
            raise @engine.Invalid("invalid scenario seed")
          }
          n.to_int()
        }
        Null => 42
        _ => raise @engine.Invalid("invalid scenario seed")
      }
      {
        "case": Json(
          @engine.scenario_case(
            spec,
            @engine.field(arguments, "step"),
            @engine.field(arguments, "bindings"),
            seed~,
          ),
        ),
      }
    }
    "capture" =>
      {
        "bindings": @engine.capture_values(
          @engine.field(arguments, "step"),
          @engine.field(arguments, "body"),
          @engine.field(arguments, "bindings"),
        ),
      }
    "validate" => {
      let case_ : @engine.Case = @json.from_json(
        @engine.field(arguments, "case"),
      )
      let status = match @engine.field(arguments, "status") {
        Number(n, ..) => {
          guard n >= 0.0 && n <= 599.0 && n == n.to_int().to_double() else {
            raise @engine.Invalid("invalid HTTP status")
          }
          n.to_int()
        }
        _ => 0
      }
      let (body, valid) = if @engine.field(arguments, "raw") is String(raw) {
        (@engine.bounded_json(raw), true) catch {
          _ => (null, false)
        }
      } else {
        (
          @engine.field(arguments, "body"),
          @engine.field(arguments, "json_valid") is True,
        )
      }
      {
        "finding": Json(
          @engine.validate_response(
            @engine.operation(spec, case_.operation_id),
            case_,
            status,
            body,
            json_valid=valid,
          ),
        ),
      }
    }
    "shrink" => {
      let case_ : @engine.Case = @json.from_json(
        @engine.field(arguments, "case"),
      )
      {
        "candidates": Json(
          @engine.shrink_candidates(
            @engine.operation(spec, case_.operation_id),
            case_,
          ),
        ),
      }
    }
    _ => raise @engine.Invalid("unsupported action")
  }
}

///|
pub fn dispatch(input : String) -> String {
  try {
    let output : Json = { "ok": true, "value": command(input) }
    output.stringify()
  } catch {
    @engine.Invalid(message) => {
      let output : Json = { "ok": false, "error": Json(message) }
      output.stringify()
    }
    _ => {
      let output : Json = {
        "ok": false,
        "error": "malformed description or command",
      }
      output.stringify()
    }
  }
}

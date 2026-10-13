///|
fn command(input : String) -> Json raise {
  let arguments=@engine.bounded_json(input)
  let action=@engine.text(@engine.field(arguments,"action"))
  let spec=@engine.parse_openapi(@engine.text(@engine.field(arguments,"source")))
  match action {
    "plan" => {
      let seed = match @engine.field(arguments,"seed") { Number(n,..) => { guard n>=0.0 && n<=1000000.0 && n==n.to_int().to_double() else { raise @engine.Invalid("invalid seed") }; n.to_int() }; _ => 42 }
      let limit = match @engine.field(arguments,"limit") { Number(n,..) => { guard n>=1.0 && n<=256.0 && n==n.to_int().to_double() else { raise @engine.Invalid("invalid case limit") }; n.to_int() }; _ => 64 }
      {"cases":Json(@engine.plan(spec,seed~,limit~)),"operations":Json(spec.operations)}
    }
    "scenario" => {"case":Json(@engine.scenario_case(spec,@engine.field(arguments,"step"),@engine.field(arguments,"bindings")))}
    "capture" => {"bindings":@engine.capture_values(@engine.field(arguments,"step"),@engine.field(arguments,"body"),@engine.field(arguments,"bindings"))}
    "validate" => {
      let case_ : @engine.Case = @json.from_json(@engine.field(arguments,"case"))
      let status=match @engine.field(arguments,"status") { Number(n,..) => { guard n>=0.0 && n<=599.0 && n==n.to_int().to_double() else { raise @engine.Invalid("invalid HTTP status") }; n.to_int() }; _ => 0 }
      {"finding":Json(@engine.validate_response(@engine.operation(spec,case_.operation_id),case_,status,@engine.field(arguments,"body"),json_valid=@engine.field(arguments,"json_valid") is True))}
    }
    "shrink" => {
      let case_ : @engine.Case = @json.from_json(@engine.field(arguments,"case"))
      {"candidates":Json(@engine.shrink_candidates(@engine.operation(spec,case_.operation_id),case_))}
    }
    _ => raise @engine.Invalid("unsupported action")
  }
}

///|
pub fn dispatch(input : String) -> String {
  try { let output : Json = {"ok":true,"value":command(input)}; output.stringify() } catch { error => { let output : Json = {"ok":false,"error":"\{error}"}; output.stringify() } }
}

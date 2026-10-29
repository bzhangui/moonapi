///|
/// Separate bridge from legacy input: modern graphs have a larger explicit
/// budget and retain all original JSON number lexemes across the FFI boundary.
pub fn modern_dispatch(
  input : String,
  pattern : (String, String) -> Bool,
  format : (String, String) -> Bool,
) -> String {
  try {
    guard input.length() <= 8388608 else {
      raise @engine.Invalid("modern bridge budget")
    }
    let r = @json.parse(
      input,
      max_nesting_depth=128,
      reject_duplicate_keys=true,
      preserve_number_repr=true,
    )
    @engine.modern_validate(
      @engine.field(r, "schema"),
      @engine.field(r, "documents"),
      @engine.field(r, "data"),
      @engine.field(r, "binaries"),
      pattern,
      format,
      assert_formats=@engine.field(r, "assertFormats") == Json(true),
      mode=@engine.text(@engine.field(r, "mode")),
      direction=@engine.text(@engine.field(r, "directionPolicy")),
    ).stringify()
  } catch {
    @engine.Invalid(message) => Json({ "error": Json(message) }).stringify()
    _ =>
      Json({ "error": Json("MODERN_SCHEMA_RESOURCE_OR_INPUT_REJECTED") }).stringify()
  }
}

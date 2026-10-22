///|
// Reference Objects are resolved without network I/O. OAS 3.0 ref siblings
// are ignored by the standard; reject them rather than silently lose intent.
fn resolve_component(
  root : Json,
  value : Json,
  category : String,
  depth : Int32,
) -> Json raise TestError {
  guard depth <= 16 else { raise Invalid("component reference depth exceeded") }
  check_object(value, "component must be object")
  if field(value, "$ref") is String(reference) {
    guard fields(value) == ["$ref"] else {
      raise Invalid("reference siblings unsupported")
    }
    let prefix = "#/components/" + category + "/"
    guard reference.has_prefix(prefix) && reference.length() <= 512 else {
      raise Invalid("only same-kind local component references supported")
    }
    let encoded = reference.strip_prefix(prefix).unwrap().to_owned()
    guard !encoded.contains("/") else {
      raise Invalid("nested reference unsupported")
    }
    // Decode RFC 6901 exactly once; reject malformed tilde escapes.
    let chars = encoded.to_array()
    let out = []
    let mut i = 0
    while i < chars.length() {
      if chars[i] == '~' {
        guard i + 1 < chars.length() &&
          (chars[i + 1] == '0' || chars[i + 1] == '1') else {
          raise Invalid("malformed reference escape")
        }
        out.push(if chars[i + 1] == '0' { '~' } else { '/' })
        i += 2
      } else {
        out.push(chars[i])
        i += 1
      }
    }
    let name = String::from_array(out)
    let target = field(field(field(root, "components"), category), name)
    return resolve_component(root, target, category, depth + 1)
  }
  guard !fields(value).contains("$ref") else {
    raise Invalid("invalid component reference")
  }
  value
}

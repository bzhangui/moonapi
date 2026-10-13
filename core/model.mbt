///|
pub(all) suberror TestError { Invalid(String) } derive(Debug)

///|
pub(all) struct Operation {
  id : String
  verb : String
  path : String
  parameters : Array[Json]
  request : Json
  responses : Json
} derive(Debug, ToJson, FromJson)

///|
pub(all) struct Spec { operations : Array[Operation] } derive(Debug, ToJson, FromJson)

///|
pub(all) struct Case {
  id : String
  operation_id : String
  verb : String
  path : String
  parameters : Array[Json]
  body : Json
  has_body : Bool
  negative : Bool
  expected_status : Int
} derive(Debug, ToJson, FromJson)

///|
pub(all) struct Issue { code : String; pointer : String; message : String } derive(Debug, ToJson, FromJson)

///|
pub(all) struct Finding { passed : Bool; fingerprint : String; issues : Array[Issue] } derive(Debug, ToJson, FromJson)

///|
pub fn field(value : Json, key : String) -> Json {
  match value { Object(map) => map.get(key).unwrap_or(null); _ => null }
}

///|
pub fn text(value : Json) -> String raise TestError {
  match value { String(s) => s; _ => raise Invalid("string expected") }
}

///|
fn fields(value : Json) -> Array[String] {
  let out = []
  if value is Object(map) { for (key, _) in map { out.push(key) } }
  out.sort()
  out
}

///|
fn array(value : Json) -> Array[Json] {
  match value { Array(xs) => xs; _ => [] }
}

///|
fn numeric(value : Json, fallback : Double) -> Double {
  match value { Number(n, ..) => n; _ => fallback }
}

///|
pub fn bounded_json(text : String) -> Json raise {
  guard text.length() <= 4194304 && @utf8.encode(text).length() <= 4194304 else { raise Invalid("JSON byte budget exceeded") }
  let mut depth = 0
  let mut quoted = false
  let mut escaped = false
  for ch in text {
    if quoted {
      if escaped { escaped = false } else if ch == '\\' { escaped = true } else if ch == '"' { quoted = false }
    } else if ch == '"' { quoted = true
    } else if ch == '{' || ch == '[' { depth += 1; guard depth <= 48 else { raise Invalid("JSON nesting budget exceeded") }
    } else if ch == '}' || ch == ']' { depth -= 1 }
  }
  @json.parse(text)
}

///|
fn check_object(value : Json, message : String) -> Unit raise TestError {
  guard value is Object(_) else { raise Invalid(message) }
}

///|
fn safe_name(name : String) -> Unit raise TestError {
  guard name.length() > 0 && name.length() <= 256 else { raise Invalid("invalid name budget") }
  for c in name { guard c >= ' ' && c != '\u007f' else { raise Invalid("control character in name") } }
}

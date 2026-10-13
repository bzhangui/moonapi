///|
test "bounded JSON and strict scalar contracts" {
  let schema : Json = {"type":"integer","minimum":0,"maximum":10}
  assert_true(validate_value(schema,5).is_empty())
  assert_true(!validate_value(schema,1.5).is_empty())
  assert_true(!validate_value(schema,11).is_empty())
  assert_true(!validate_value(schema,"5").is_empty())
  assert_true(validate_value({"type":"string","maxLength":1},"😀").is_empty())
}

///|
test "objects arrays required enum and nullable" {
  let schema : Json = {"type":"object","required":["id"],"properties":{"id":{"type":"integer"}},"additionalProperties":false}
  assert_true(validate_value(schema,{"id":1}).is_empty())
  assert_true(!validate_value(schema,{}).is_empty())
  assert_true(!validate_value(schema,{"id":1,"other":true}).is_empty())
  assert_true(validate_value({"type":"string","nullable":true},null).is_empty())
  assert_true(!validate_value({"type":"string","enum":["a","b"]},"c").is_empty())
}

///|
test "schema generation is deterministic" {
  let schema : Json = {"type":"object","required":["name"],"properties":{"name":{"type":"string","minLength":3},"enabled":{"type":"boolean"},"numbers":{"type":"array","minItems":2,"items":{"type":"integer","minimum":0,"maximum":10}}}}
  let value = generate_value(schema,42)
  assert_true(value == generate_value(schema,42))
  assert_true(validate_value(schema,value).is_empty())
}

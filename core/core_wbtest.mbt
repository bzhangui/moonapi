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

///|
fn fixture_spec() -> Spec raise {
  let source = #|{"openapi":"3.0.3","paths":{"/items":{"post":{"operationId":"create","requestBody":{"content":{"application/json":{"schema":{"type":"object","required":["name"],"properties":{"name":{"type":"string","minLength":1,"maxLength":20},"optional":{"type":"integer","minimum":0,"maximum":10}}}}}},"responses":{"201":{"content":{"application/json":{"schema":{"type":"object","required":["id"],"properties":{"id":{"type":"integer"}}}}}},"400":{"content":{"application/json":{"schema":{"type":"object","properties":{"error":{"type":"string"}}}}}}}}},"/items/{id}":{"get":{"operationId":"read","parameters":[{"name":"id","in":"path","required":true,"schema":{"type":"integer","minimum":1}}],"responses":{"200":{"content":{"application/json":{"schema":{"type":"object","required":["id"],"properties":{"id":{"type":"integer"}}}}}},"404":{}}}}}}
  parse_openapi(source)
}

///|
test "OpenAPI local references deterministic operation ordering and budgets" {
  let spec=fixture_spec()
  assert_true(spec.operations.length()==2)
  let cases=plan(spec,limit=8)
  assert_true(cases.length()==8)
  assert_true(cases.any(c=>c.negative))
  assert_true(plan(spec,seed=99,limit=1).length()==1)
  assert_true(generate_value({"type":"integer","minimum":0.5,"maximum":2.5},0)==1)
  assert_true(generate_value({"type":"integer","minimum":0.5,"maximum":2.5},1)==2)
}

///|
test "negative inputs server errors exact response types and fingerprints" {
  let op=operation(fixture_spec(),"create")
  let case_=make_case(op,42)
  assert_true(validate_response(op,case_,201,{"id":1}).passed)
  assert_true(!validate_response(op,case_,201,{"id":"wrong"}).passed)
  assert_true(validate_response(op,case_,201,{"id":"wrong"}).fingerprint=="201:type:$/id")
  assert_true(!validate_response(op,case_,500,{"error":"broken"}).passed)
  assert_true(!validate_response(op,{..case_,negative:true},201,{"id":1}).passed)
  assert_true(validate_response(op,{..case_,negative:true},400,{"error":"invalid"}).passed)
}

///|
test "failure shrinking retains valid request semantics" {
  let op=operation(fixture_spec(),"create")
  let case_=make_case(op,42)
  let smaller=shrink_candidates(op,case_)
  assert_true(!smaller.is_empty())
  for candidate in smaller { assert_true(validate_value(op.request,candidate.body).is_empty()); assert_true(candidate.body.stringify().length()<case_.body.stringify().length()) }
}

///|
test "stateful captures bind actual identifiers without evaluation" {
  let spec=fixture_spec()
  let bindings=capture_values({"capture":{"item_id":"/id"}},{"id":7},Json::empty_object())
  let next=scenario_case(spec,{"operationId":"read","parameters":{"id":{"$from":"item_id"}},"status":200},bindings)
  assert_true(field(next.parameters[0],"value")==7)
  assert_true(next.expected_status==200)
  assert_true(json_pointer({"a/b":{"~x":[42]}},"/a~1b/~0x/0")==42)
}

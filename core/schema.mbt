///|
fn resolve_schema(root : Json, schema : Json, depth : Int, budget? : Array[Int] = [0]) -> Json raise TestError {
  budget[0] += 1
  guard budget[0] <= 4096 else { raise Invalid("expanded schema node budget exceeded") }
  guard depth <= 16 else { raise Invalid("schema depth or recursive reference unsupported") }
  check_object(schema, "schema must be object")
  if field(schema, "$ref") is String(reference) {
    guard reference.has_prefix("#/components/schemas/") && reference.length() <= 512 else { raise Invalid("only local component schema references supported") }
    let name = reference.strip_prefix("#/components/schemas/").unwrap().to_owned()
    guard !name.contains("/") && !name.contains("~") else { raise Invalid("escaped schema reference names unsupported") }
    return resolve_schema(root, field(field(field(root, "components"), "schemas"), name), depth + 1,budget~)
  }
  let allowed = ["type", "properties", "required", "items", "enum", "nullable", "minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems", "additionalProperties", "description", "title", "example", "default"]
  for key in fields(schema) { guard allowed.contains(key) else { raise Invalid("unsupported schema keyword: \{key}") } }
  let kind = text(field(schema, "type"))
  guard ["object", "array", "string", "integer", "number", "boolean"].contains(kind) else { raise Invalid("unsupported schema type") }
  let values : Map[String, Json] = Map([])
  for key in fields(schema) { values[key] = field(schema, key) }
  if kind == "object" {
    let properties = field(schema, "properties")
    if properties != null { check_object(properties, "properties must be object") }
    guard fields(properties).length() <= 64 else { raise Invalid("property budget exceeded") }
    let mapped : Map[String, Json] = Map([])
    for name in fields(properties) { safe_name(name); mapped[name] = resolve_schema(root, field(properties, name), depth + 1,budget~) }
    if field(schema,"required") != null { guard field(schema,"required") is Array(_) else { raise Invalid("required must be array") } }
    for required in array(field(schema, "required")) { guard mapped.contains(text(required)) else { raise Invalid("required property missing from schema") } }
    guard field(schema, "additionalProperties") == null || field(schema, "additionalProperties") is True || field(schema, "additionalProperties") is False else { raise Invalid("schema-valued additionalProperties unsupported") }
    values["properties"] = Json(mapped)
  }
  if kind == "array" { values["items"] = resolve_schema(root, field(schema, "items"), depth + 1,budget~) }
  if field(schema, "nullable") != null { guard field(schema, "nullable") is True || field(schema, "nullable") is False else { raise Invalid("nullable must be boolean") } }
  for key in ["minLength", "maxLength", "minItems", "maxItems"] {
    if field(schema, key) != null {
      let value = numeric(field(schema, key), -1.0)
      guard value >= 0.0 && value <= 4096.0 && value == value.to_int().to_double() else { raise Invalid("invalid schema size budget") }
    }
  }
  for (lower, upper) in [("minimum", "maximum"), ("minLength", "maxLength"), ("minItems", "maxItems")] {
    guard numeric(field(schema, lower), 0.0) <= numeric(field(schema, upper), 1000000.0) else { raise Invalid("inverted schema bounds") }
  }
  for key in ["minimum", "maximum"] { if field(schema, key) != null { let value = numeric(field(schema, key), 1000001.0); guard value >= -1000000.0 && value <= 1000000.0 else { raise Invalid("numeric generation budget exceeded") } } }
  if field(schema, "enum") != null { guard field(schema, "enum") is Array(xs) && xs.length() > 0 && xs.length() <= 32 else { raise Invalid("invalid enum") } }
  let normalized=Json(values)
  if field(normalized,"enum") is Array(choices) { for choice in choices { guard validate_value(normalized,choice).is_empty() else { raise Invalid("enum value violates its schema") } } }
  normalized
}

///|
fn validate_inner(schema : Json, value : Json, pointer : String, depth : Int, budget : Array[Int]) -> Array[Issue] {
  budget[0] += 1
  if depth > 20 || budget[0] > 10000 { return [{code:"value_budget",pointer,message:"validation node/depth budget exceeded"}] }
  let issues = []
  fn add(code, message) { issues.push({code, pointer, message}) }
  if field(schema, "enum") is Array(xs) { if !xs.contains(value) { add("enum", "value not in declared enum") } }
  if value == null && field(schema, "nullable") is True { return issues }
  match field(schema, "type") {
    String("object") => match value {
      Object(map) => {
        if map.length() > 64 { return [{code:"object_budget",pointer,message:"object property budget exceeded"}] }
        let properties = field(schema, "properties")
        for required in array(field(schema, "required")) { if required is String(name) { if !map.contains(name) { issues.push({code:"required", pointer:pointer+"/"+name, message:"required property missing"}) } } }
        for name in fields(value) {
          let rule = field(properties, name)
          if rule == null {
            if field(schema,"additionalProperties") is False { issues.push({code:"additional_property",pointer:pointer+"/"+name,message:"undeclared property"}) }
          } else { for issue in validate_inner(rule, field(value,name),pointer+"/"+name,depth+1,budget) { if issues.length() < 256 { issues.push(issue) } } }
        }
      }
      _ => add("type", "object expected")
    }
    String("array") => match value {
      Array(xs) => {
        if xs.length() > 4096 { return [{code:"array_budget",pointer,message:"array item budget exceeded"}] }
        if xs.length().to_double() < numeric(field(schema,"minItems"),0.0) || xs.length().to_double() > numeric(field(schema,"maxItems"),4096.0) { add("array_size","array outside bounds") }
        for i = 0; i < xs.length(); i = i + 1 { for issue in validate_inner(field(schema,"items"),xs[i],pointer+"/\{i}",depth+1,budget) { if issues.length() < 256 { issues.push(issue) } } }
      }
      _ => add("type","array expected")
    }
    String("string") => match value {
      String(s) => { if s.char_length().to_double() < numeric(field(schema,"minLength"),0.0) || s.char_length().to_double() > numeric(field(schema,"maxLength"),4096.0) { add("string_size","string outside bounds") } }
      _ => add("type","string expected")
    }
    String("integer") | String("number") => match value {
      Number(n, ..) => {
        if n.is_inf() || n.is_nan() { add("non_finite","finite JSON number required") }
        if field(schema,"type") == "integer" && (n < -9007199254740991.0 || n > 9007199254740991.0 || n != n.trunc()) { add("integer","safe exact integer expected") }
        if (field(schema,"minimum")!=null && n < numeric(field(schema,"minimum"),0.0)) || (field(schema,"maximum")!=null && n > numeric(field(schema,"maximum"),0.0)) { add("number_bounds","number outside bounds") }
      }
      _ => add("type","number expected")
    }
    String("boolean") => { if !(value is True) && !(value is False) { add("type","boolean expected") } }
    _ => add("unsupported_schema","supported explicit schema type required")
  }
  issues
}

///|
fn generate_inner(schema : Json, seed : Int, depth : Int, budget : Array[Int]) -> Json raise TestError {
  budget[0] += 1
  guard depth <= 16 && budget[0] <= 10000 else { raise Invalid("generated value budget exceeded") }
  if field(schema,"enum") is Array(xs) { return xs[(seed & 2147483647) % xs.length()] }
  match field(schema,"type") {
    String("object") => {
      let value : Map[String,Json] = Map([])
      let properties = field(schema,"properties")
      guard fields(properties).length() <= 64 else { raise Invalid("generated property budget exceeded") }
      for name in fields(properties) { value[name] = generate_inner(field(properties,name),seed,depth+1,budget) }
      Json(value)
    }
    String("array") => {
      let count = if seed == 1 { numeric(field(schema,"maxItems"),2.0).to_int() } else { numeric(field(schema,"minItems"),1.0).to_int() }
      let count = if count > numeric(field(schema,"maxItems"),4096.0).to_int() { 0 } else { count }
      guard count >= 0 && count <= 4096 else { raise Invalid("generated array budget exceeded") }
      let out = []
      for i = 0; i < count; i = i + 1 { out.push(generate_inner(field(schema,"items"),seed,depth+1,budget)) }
      Json(out)
    }
    String("string") => {
      let minimum = numeric(field(schema,"minLength"),0.0).to_int()
      let maximum = numeric(field(schema,"maxLength"),4096.0).to_int()
      guard minimum >= 0 && maximum >= minimum && maximum <= 4096 else { raise Invalid("generated string budget exceeded") }
      let length = if seed == 0 { minimum } else if seed == 1 { if field(schema,"maxLength") == null { if minimum > 16 { minimum } else { 16 } } else { maximum } } else if minimum > 8 { minimum } else if maximum < 8 { maximum } else { 8 }
      let mut value = ""
      for i = 0; i < length; i = i + 1 { value += if (seed+i) % 2 == 0 { "a" } else { "b" } }
      Json(value)
    }
    String("integer") | String("number") => {
      let lower = numeric(field(schema,"minimum"),0.0)
      let upper = numeric(field(schema,"maximum"),lower+10.0)
      guard lower >= -1000000.0 && upper <= 1000000.0 && lower <= upper else { raise Invalid("generated numeric budget exceeded") }
      let lower = if field(schema,"type") == "integer" { let n=lower.to_int(); if lower>n.to_double() { (n+1).to_double() } else { n.to_double() } } else { lower }
      let upper = if field(schema,"type") == "integer" { let n=upper.to_int(); if upper<n.to_double() { (n-1).to_double() } else { n.to_double() } } else { upper }
      guard lower <= upper else { raise Invalid("no integer satisfies bounds") }
      let value = if seed == 0 { lower } else if seed == 1 { upper } else { lower + ((seed & 2147483647) % 11).to_double() }
      Json(if value > upper { lower } else { value })
    }
    String("boolean") => Json(seed % 2 == 0)
    _ => raise Invalid("cannot generate unsupported schema")
  }
}

///|
pub fn validate_value(schema : Json, value : Json, pointer? : String = "$") -> Array[Issue] {
  validate_inner(schema,value,pointer,0,[0])
}

///|
pub fn generate_value(schema : Json, seed : Int) -> Json raise TestError {
  generate_inner(schema,seed,0,[0])
}

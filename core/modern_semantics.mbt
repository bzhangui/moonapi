///|
/// Exact JSON Schema instance semantics. URI resolution and ECMA regex/format
/// leaves are supplied by the host; no network, filesystem or JS evaluator here.
priv struct ModernResult {
  mut valid : Bool
  pending : Bool
  props : Map[String, Bool]
  items : Map[Int32, Bool]
  errors : Array[String]
}

///|
priv struct ModernTask {
  schema : Json
  data : Json
  path : String
  kind : String
  depth : Int32
}

///|
priv struct ModernContext {
  documents : Json
  binaries : Json
  pattern : (String, String) -> Bool
  format : (String, String) -> Bool
  assert_formats : Bool
  mode : String
  direction : String
  mut operations : Int32
  mut pending : Bool
  mut key_bytes : Int32
  queue : Array[ModernTask]
  cache : Map[String, ModernResult]
  schemas : Map[String, Int32]
}

///|
/// Structural schema identity includes exact numeric lexemes. Hash-map keys
/// retain full equality checks; a hash collision cannot alias different schemas.
fn ModernContext::task_key(
  self : ModernContext,
  task : ModernTask,
) -> String raise {
  guard task.depth <= 256 else {
    raise Invalid("MODERN_SCHEMA_RESOURCE_BUDGET")
  }
  let schema = task.schema.stringify()
  self.key_bytes = self.key_bytes + schema.length() + task.path.length()
  guard self.key_bytes <= 67108864 else {
    raise Invalid("MODERN_SCHEMA_RESOURCE_BUDGET")
  }
  let id = match self.schemas.get(schema) {
    Some(id) => id
    None => {
      let id = self.schemas.length()
      self.schemas[schema] = id
      id
    }
  }
  Json([Json(id), Json(task.path), Json(task.kind), Json(task.depth)]).stringify()
}

///|
/// Dependencies are queued, never evaluated on the host call stack. An unknown
/// child cannot authorize an if branch or unevaluated* assertion speculatively.
fn ModernContext::child(
  self : ModernContext,
  schema : Json,
  data : Json,
  path : String,
  kind : String,
  depth : Int32,
) -> ModernResult raise {
  let task : ModernTask = { schema, data, path, kind, depth, }
  let key = self.task_key(task)
  match self.cache.get(key) {
    Some(result) => result
    None => {
      guard self.queue.length() < 200000 else {
        raise Invalid("MODERN_SCHEMA_RESOURCE_BUDGET")
      }
      self.pending = true
      self.queue.push(task)
      {
        valid: true,
        pending: true,
        props: Map([]),
        items: Map([]),
        errors: [],
      }
    }
  }
}

///|
fn modern_has(value : Json, key : String) -> Bool {
  match value {
    Object(m) => m.contains(key)
    _ => false
  }
}

///|
fn modern_pointer(key : String) -> String {
  key.replace(old="~", new="~0").replace(old="/", new="~1")
}

///|
/// Parse the preserved JSON number lexeme, never its rounded Double projection.
fn modern_decimal(value : Json) -> (@bigint.BigInt, Int32) raise {
  guard value is Number(_, ..) else { raise Invalid("modern number required") }
  let chars = value.stringify().to_array()
  let digits = StringBuilder()
  let mut fraction = 0
  let mut after_dot = false
  let mut exponent = 0
  let mut exponent_sign = 1
  let mut in_exponent = false
  for c in chars {
    if c == 'e' || c == 'E' {
      in_exponent = true
    } else if in_exponent {
      if c == '-' {
        exponent_sign = -1
      } else if c != '+' {
        exponent = exponent * 10 + c.to_int() - '0'.to_int()
        guard exponent <= 10000 else {
          raise Invalid("MODERN_SCHEMA_NUMBER_BUDGET")
        }
      }
    } else if c == '.' {
      after_dot = true
    } else {
      digits.write_char(c)
      if after_dot {
        fraction = fraction + 1
      }
    }
  }
  let coefficient = digits.to_string()
  guard coefficient.length() <= 4096 else {
    raise Invalid("MODERN_SCHEMA_NUMBER_BUDGET")
  }
  let mut n = @bigint.BigInt::from_string(coefficient)
  let mut e = exponent * exponent_sign - fraction
  guard e >= -10000 && e <= 10000 else {
    raise Invalid("MODERN_SCHEMA_NUMBER_BUDGET")
  }
  if n == 0 {
    return (@bigint.BigInt::from_int(0), 0)
  }
  while n % 10 == 0 {
    n = n / 10
    e = e + 1
  }
  guard e <= 10000 else { raise Invalid("MODERN_SCHEMA_NUMBER_BUDGET") }
  (n, e)
}

///|
fn modern_compare(a : Json, b : Json) -> Int32 raise {
  let (x, e) = modern_decimal(a)
  let (y, f) = modern_decimal(b)
  let z = if e < f { e } else { f }
  scale_decimal(x, e - z).compare(scale_decimal(y, f - z))
}

///|
fn modern_type(value : Json, binary : Bool) -> String {
  if binary {
    return "binary"
  }
  match value {
    Null => "null"
    True | False => "boolean"
    Number(_, ..) => "number"
    String(_) => "string"
    Array(_) => "array"
    Object(_) => "object"
  }
}

///|
fn modern_canonical(
  value : Json,
  path : String,
  binaries : Json,
) -> String raise {
  if field(binaries, path) is String(hex) {
    return "b" + hex
  }
  match value {
    Null => "z"
    True => "t"
    False => "f"
    Number(_, ..) => {
      let (n, e) = modern_decimal(value)
      "n\{n}e\{e}"
    }
    String(_) => "s" + value.stringify()
    Array(xs) => {
      let out = StringBuilder()
      out.write_string("[")
      for i, x in xs {
        out.write_string(modern_canonical(x, path + "/\{i}", binaries))
        out.write_string(",")
      }
      out.write_string("]")
      out.to_string()
    }
    Object(m) => {
      let out = StringBuilder()
      out.write_string("{")
      for k in fields(value) {
        out.write_string(Json(k).stringify())
        out.write_string(":")
        out.write_string(
          modern_canonical(m[k], path + "/" + modern_pointer(k), binaries),
        )
        out.write_string(",")
      }
      out.write_string("}")
      out.to_string()
    }
  }
}

///|
fn ModernResult::fail(self : ModernResult, name : String) -> Unit {
  self.valid = false
  if self.errors.length() < 16 {
    self.errors.push(name)
  }
}

///|
/// Only successful same-instance annotations propagate into unevaluated*.
fn ModernResult::merge(self : ModernResult, other : ModernResult) -> Unit {
  if other.valid {
    for k, v in other.props {
      self.props[k] = v
    }
    for k, v in other.items {
      self.items[k] = v
    }
  }
}

///|
fn ModernContext::evaluate(
  self : ModernContext,
  schema : Json,
  data : Json,
  path : String,
  kind : String,
  depth : Int32,
) -> ModernResult raise {
  self.operations = self.operations + 1
  guard self.operations <= 200000 && depth <= 256 else {
    raise Invalid("MODERN_SCHEMA_RESOURCE_BUDGET")
  }
  let r : ModernResult = {
    valid: true,
    pending: false,
    props: Map([]),
    items: Map([]),
    errors: [],
  }
  let has = fn(k) { modern_has(schema, k) }
  let get = fn(k) { field(schema, k) }
  let child = fn(s) raise { self.child(s, data, path, kind, depth + 1) }
  if schema == Json(false) {
    r.fail("false schema")
  } else if schema != Json(true) {
    if get("$ref") is String(uri) {
      guard modern_has(self.documents, uri) else {
        raise Invalid("MODERN_SCHEMA_INVALID_OR_UNGRANTED")
      }
      let result = child(field(self.documents, uri))
      if !result.valid {
        r.fail("$ref")
      } else {
        r.merge(result)
      }
    }
    let binary = kind == "value" && modern_has(self.binaries, path)
    let t = modern_type(data, binary)
    if has("type") {
      let types = match get("type") {
        Array(xs) => xs
        x => [x]
      }
      let mut found = false
      for x in types {
        if x == Json(t) {
          found = true
        }
        if x == Json("integer") && t == "number" {
          let (_, e) = modern_decimal(data)
          if e >= 0 {
            found = true
          }
        }
      }
      if !found {
        r.fail("type")
      }
    }
    if self.direction == "reject-forbidden" &&
      (
        (self.mode == "write" && get("readOnly") == Json(true)) ||
        (self.mode == "read" && get("writeOnly") == Json(true))
      ) {
      r.fail("direction")
    }
    if has("const") &&
      (
        binary ||
        modern_canonical(
          data,
          path,
          if kind == "value" {
            self.binaries
          } else {
            Json::null()
          },
        ) !=
        modern_canonical(get("const"), "", Json::null())
      ) {
      r.fail("const")
    }
    if get("enum") is Array(xs) {
      let actual = modern_canonical(
        data,
        path,
        if kind == "value" {
          self.binaries
        } else {
          Json::null()
        },
      )
      let mut found = false
      for x in xs {
        if !binary && actual == modern_canonical(x, "", Json::null()) {
          found = true
        }
      }
      if !found {
        r.fail("enum")
      }
    }
    if t == "number" {
      let mut valid = true
      for name in ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"] {
        if has(name) {
          let cmp = modern_compare(data, get(name))
          if (name == "minimum" && cmp < 0) ||
            (name == "maximum" && cmp > 0) ||
            (name == "exclusiveMinimum" && cmp <= 0) ||
            (name == "exclusiveMaximum" && cmp >= 0) {
            valid = false
          }
        }
      }
      if has("multipleOf") {
        let (a, e) = modern_decimal(data)
        let (b, f) = modern_decimal(get("multipleOf"))
        let z = if e < f { e } else { f }
        guard b > 0 else { raise Invalid("MODERN_SCHEMA_INVALID_OR_UNGRANTED") }
        if scale_decimal(a, e - z) % scale_decimal(b, f - z) != 0 {
          valid = false
        }
      }
      if !valid {
        r.fail("numeric")
      }
    }
    if self.assert_formats && get("format") is String(name) {
      if name == "int32" || name == "int64" {
        if t == "number" {
          let (_, e) = modern_decimal(data)
          let low = if name == "int32" {
            @json.parse("-2147483648", preserve_number_repr=true)
          } else {
            @json.parse("-9223372036854775808", preserve_number_repr=true)
          }
          let high = if name == "int32" {
            @json.parse("2147483647", preserve_number_repr=true)
          } else {
            @json.parse("9223372036854775807", preserve_number_repr=true)
          }
          if e < 0 ||
            modern_compare(data, low) < 0 ||
            modern_compare(data, high) > 0 {
            r.fail("format")
          }
        }
      } else if !binary && !(self.format)(name, data.stringify()) {
        r.fail("format")
      }
    }
    if t == "string" && data is String(s) {
      let length = Json(s.to_array().length())
      if has("minLength") && modern_compare(length, get("minLength")) < 0 {
        r.fail("minLength")
      }
      if has("maxLength") && modern_compare(length, get("maxLength")) > 0 {
        r.fail("maxLength")
      }
      if get("pattern") is String(pattern) && !(self.pattern)(pattern, s) {
        r.fail("pattern")
      }
    }
    for sub in array(get("allOf")) {
      let result = child(sub)
      if !result.valid {
        r.fail("allOf")
      } else {
        r.merge(result)
      }
    }
    for name in ["anyOf", "oneOf"] {
      if has(name) {
        let passing : Array[ModernResult] = []
        for sub in array(get(name)) {
          let x = child(sub)
          if x.valid {
            passing.push(x)
          }
        }
        if passing.length() == 0 || (name == "oneOf" && passing.length() != 1) {
          r.fail(name)
        } else {
          for x in passing {
            r.merge(x)
          }
        }
      }
    }
    if has("not") && child(get("not")).valid {
      r.fail("not")
    }
    if has("if") {
      let condition = child(get("if"))
      if !condition.pending {
        if condition.valid {
          r.merge(condition)
        }
        let branch = if condition.valid { "then" } else { "else" }
        if has(branch) {
          let x = child(get(branch))
          if !x.valid {
            r.fail(branch)
          } else {
            r.merge(x)
          }
        }
      }
    }
    if t == "object" && data is Object(m) {
      let keys = fields(data)
      let matched : Map[String, Bool] = Map([])
      if has("minProperties") &&
        modern_compare(Json(keys.length()), get("minProperties")) < 0 {
        r.fail("minProperties")
      }
      if has("maxProperties") &&
        modern_compare(Json(keys.length()), get("maxProperties")) > 0 {
        r.fail("maxProperties")
      }
      for k in array(get("required")) {
        if k is String(k) && !m.contains(k) {
          r.fail("required")
        }
      }
      let property = fn(sub, k, name) raise {
        if !self.child(
            sub,
            m[k],
            path + "/" + modern_pointer(k),
            kind,
            depth + 1,
          ).valid {
          r.fail(name)
        } else {
          r.props[k] = true
        }
      }
      for k in fields(get("properties")) {
        if m.contains(k) {
          matched[k] = true
          property(field(get("properties"), k), k, "properties")
        }
      }
      for pattern in fields(get("patternProperties")) {
        for k in keys {
          if (self.pattern)(pattern, k) {
            matched[k] = true
            property(
              field(get("patternProperties"), pattern),
              k,
              "patternProperties",
            )
          }
        }
      }
      if has("additionalProperties") {
        for k in keys {
          if !matched.contains(k) {
            property(get("additionalProperties"), k, "additionalProperties")
          }
        }
      }
      if has("propertyNames") {
        for k in keys {
          if !self.child(
              get("propertyNames"),
              Json(k),
              path + "/" + modern_pointer(k),
              "propertyName",
              depth + 1,
            ).valid {
            r.fail("propertyNames")
          }
        }
      }
      for k in fields(get("dependentRequired")) {
        if m.contains(k) {
          for name in array(field(get("dependentRequired"), k)) {
            if name is String(name) && !m.contains(name) {
              r.fail("dependentRequired")
            }
          }
        }
      }
      for k in fields(get("dependentSchemas")) {
        if m.contains(k) {
          let x = child(field(get("dependentSchemas"), k))
          if !x.valid {
            r.fail("dependentSchemas")
          } else {
            r.merge(x)
          }
        }
      }
      if has("unevaluatedProperties") && !self.pending {
        for k in keys {
          if !r.props.contains(k) {
            property(get("unevaluatedProperties"), k, "unevaluatedProperties")
          }
        }
      }
    }
    if t == "array" && data is Array(xs) {
      if has("minItems") &&
        modern_compare(Json(xs.length()), get("minItems")) < 0 {
        r.fail("minItems")
      }
      if has("maxItems") &&
        modern_compare(Json(xs.length()), get("maxItems")) > 0 {
        r.fail("maxItems")
      }
      if get("uniqueItems") == Json(true) {
        let seen : Map[String, Bool] = Map([])
        for i, x in xs {
          let key = modern_canonical(
            x,
            path + "/\{i}",
            if kind == "value" {
              self.binaries
            } else {
              Json::null()
            },
          )
          if seen.contains(key) {
            r.fail("uniqueItems")
          }
          seen[key] = true
        }
      }
      let item = fn(sub, i, name) raise {
        if !self.child(sub, xs[i], path + "/\{i}", kind, depth + 1).valid {
          r.fail(name)
        } else {
          r.items[i] = true
        }
      }
      let prefix = array(get("prefixItems"))
      for i = 0; i < prefix.length() && i < xs.length(); i = i + 1 {
        item(prefix[i], i, "prefixItems")
      }
      if has("items") {
        for i = prefix.length(); i < xs.length(); i = i + 1 {
          item(get("items"), i, "items")
        }
      }
      if has("contains") {
        let passing : Array[Int32] = []
        for i, x in xs {
          if self.child(get("contains"), x, path + "/\{i}", kind, depth + 1).valid {
            passing.push(i)
          }
        }
        let min = if has("minContains") { get("minContains") } else { Json(1) }
        if modern_compare(Json(passing.length()), min) < 0 ||
          (
            has("maxContains") &&
            modern_compare(Json(passing.length()), get("maxContains")) > 0
          ) {
          r.fail("contains")
        } else {
          for i in passing {
            r.items[i] = true
          }
        }
      }
      if has("unevaluatedItems") && !self.pending {
        for i = 0; i < xs.length(); i = i + 1 {
          if !r.items.contains(i) {
            item(get("unevaluatedItems"), i, "unevaluatedItems")
          }
        }
      }
    }
  }
  if !r.valid {
    r.props.clear()
    r.items.clear()
  }
  r
}

///|
/// Evaluate a prevalidated, statically specialized 2020-12/OAS schema graph.
/// Hosts MUST grant/normalize URI resources and validate schema syntax first.
/// Typed binary values use a separate path-to-hex map; JSON objects cannot forge it.
pub fn modern_validate(
  schema : Json,
  documents : Json,
  data : Json,
  binaries : Json,
  pattern : (String, String) -> Bool,
  format : (String, String) -> Bool,
  assert_formats~ : Bool = false,
  mode~ : String = "annotation",
  direction~ : String = "annotation",
) -> Json raise {
  guard (mode == "annotation" || mode == "write" || mode == "read") &&
    (direction == "annotation" || direction == "reject-forbidden") else {
    raise Invalid("MODERN_SCHEMA_OPTIONS")
  }
  ignore(modern_bound_data(data, 0, 0))
  let context : ModernContext = {
    documents,
    binaries,
    pattern,
    format,
    assert_formats,
    mode,
    direction,
    operations: 0,
    pending: false,
    key_bytes: 0,
    queue: [],
    cache: Map([]),
    schemas: Map([]),
  }
  let root : ModernTask = { schema, data, path: "", kind: "value", depth: 0, }
  let root_key = context.task_key(root)
  let tasks = [root]
  while tasks.pop() is Some(task) {
    let key = context.task_key(task)
    if context.cache.contains(key) {
      continue
    }
    context.pending = false
    context.queue.clear()
    let r = context.evaluate(
      task.schema,
      task.data,
      task.path,
      task.kind,
      task.depth,
    )
    if context.pending {
      guard tasks.length() + context.queue.length() < 200000 else {
        raise Invalid("MODERN_SCHEMA_RESOURCE_BUDGET")
      }
      tasks.push(task)
      for next in context.queue {
        tasks.push(next)
      }
    } else {
      context.cache[key] = r
    }
  }
  let r = context.cache[root_key]
  Json({ "valid": Json(r.valid), "errors": Json(r.errors) })
}

///|
fn modern_bound_data(value : Json, depth : Int32, nodes : Int32) -> Int32 raise {
  guard depth <= 64 && nodes < 50000 else {
    raise Invalid("MODERN_SCHEMA_RESOURCE_BUDGET")
  }
  let mut count = nodes + 1
  match value {
    Number(_, ..) => ignore(modern_decimal(value))
    Array(xs) =>
      for x in xs {
        count = modern_bound_data(x, depth + 1, count)
      }
    Object(m) =>
      for _, x in m {
        count = modern_bound_data(x, depth + 1, count)
      }
    _ => ()
  }
  count
}

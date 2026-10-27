///|
fn decimal_parts(value : Json) -> (@bigint.BigInt, Int32) raise TestError {
  let coefficient = text(field(value, "coefficient"))
  guard coefficient.length() > 0 && coefficient.length() <= 4096 else {
    raise Invalid("decimal coefficient budget")
  }
  let chars = coefficient.to_array()
  for i = 0; i < chars.length(); i = i + 1 {
    guard (chars[i] >= '0' && chars[i] <= '9') ||
      (i == 0 && chars[i] == '-' && chars.length() > 1) else {
      raise Invalid("decimal coefficient")
    }
  }
  guard field(value, "exponent") is Number(n, ..) &&
    n >= -10000.0 &&
    n <= 10000.0 &&
    n == n.trunc() else {
    raise Invalid("decimal exponent")
  }
  let exponent = n.to_int()
  guard exponent >= -10000 && exponent <= 10000 else {
    raise Invalid("decimal exponent budget")
  }
  (@bigint.BigInt::from_string(coefficient), exponent)
}

///|
fn scale_decimal(
  coefficient : @bigint.BigInt,
  exponent : Int32,
) -> @bigint.BigInt {
  coefficient *
  @bigint.BigInt::from_int(10).pow(@bigint.BigInt::from_int(exponent))
}

///|
pub fn exact_decimal_relation(
  left : Json,
  right : Json,
  kind : String,
) -> Bool raise TestError {
  let (a, e) = decimal_parts(left)
  let (b, f) = decimal_parts(right)
  let z = if e < f { e } else { f }
  let order = scale_decimal(a, e - z).compare(scale_decimal(b, f - z))
  match kind {
    "equal" => order == 0
    "not_equal" => order != 0
    "gt" => order > 0
    "gte" => order >= 0
    "lt" => order < 0
    "lte" => order <= 0
    _ => raise Invalid("decimal relation kind")
  }
}

///|
pub fn exact_decimal_sum(
  values : Json,
  expected : Json,
) -> Bool raise TestError {
  guard values is Array(items) && items.length() <= 256 else {
    raise Invalid("decimal sum budget")
  }
  let (target, target_exp) = decimal_parts(expected)
  let parts : Array[(@bigint.BigInt, Int32)] = []
  let mut minimum = target_exp
  for value in items {
    let (a, e) = decimal_parts(value)
    parts.push((a, e))
    if e < minimum {
      minimum = e
    }
  }
  let mut total = @bigint.BigInt::from_int(0)
  for (a, e) in parts {
    total = total + scale_decimal(a, e - minimum)
  }
  total == scale_decimal(target, target_exp - minimum)
}

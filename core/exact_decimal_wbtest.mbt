///|
test "business decimal comparisons and sums never cross a floating point projection" {
  let a : Json = { "coefficient": "9223372036854775807", "exponent": 0 }
  let b : Json = { "coefficient": "9223372036854775808", "exponent": 0 }
  assert_eq(exact_decimal_relation(a, b, "lt"), true)
  assert_eq(
    exact_decimal_sum(
      [
        { "coefficient": "100000000000000000001", "exponent": -21 },
        { "coefficient": "200000000000000000002", "exponent": -21 },
      ],
      { "coefficient": "300000000000000000003", "exponent": -21 },
    ),
    true,
  )
  let rejected = try {
    ignore(
      exact_decimal_relation({ "coefficient": "1x", "exponent": 0 }, a, "equal"),
    )
    false
  } catch {
    _ => true
  }
  assert_eq(rejected, true)
}

///|
test "decimal signs exponents equality and malformed numbers are independently checked" {
  let a : Json = { "coefficient": "-100", "exponent": -2 }
  let b : Json = { "coefficient": "-1", "exponent": 0 }
  for kind in ["equal", "gte", "lte"] {
    assert_eq(exact_decimal_relation(a, b, kind), true)
  }
  for kind in ["not_equal", "gt", "lt"] {
    assert_eq(exact_decimal_relation(a, b, kind), false)
  }
  let invalid : Array[Json] = [
    { "coefficient": "", "exponent": 0 },
    { "coefficient": "-", "exponent": 0 },
    { "coefficient": "1", "exponent": 10001 },
    { "coefficient": "1", "exponent": 0.5 },
  ]
  for value in invalid {
    let rejected = try {
      ignore(exact_decimal_relation(value, b, "equal"))
      false
    } catch {
      _ => true
    }
    assert_eq(rejected, true)
  }
  assert_eq(exact_decimal_sum([], { "coefficient": "0", "exponent": 0 }), true)
  assert_eq(
    exact_decimal_sum([a], { "coefficient": "0", "exponent": 0 }),
    false,
  )
}

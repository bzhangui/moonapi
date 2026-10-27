import AjvDraft4 from "ajv-draft-04";
import addFormats from "ajv-formats";
import {
  numeric,
  decimal,
  compare,
  equal,
  number,
  cloneExact,
  setOwn,
} from "./standard-value.mjs";
const ajv = new AjvDraft4({ strict: false, logger: false });
addFormats(ajv);
const formats = new Map();
// Only annotations on the same instance participate. Do not descend into
// properties/items/not, or leak annotations from unsuccessful choice branches.
function directions(rule, value, mode, depth, seen = new Set(), choices = true) {
  if (!rule || seen.has(rule)) return new Map();
  if (depth > 128) throw new Error("STANDARD_SCHEMA_DEPTH_BUDGET");
  const next = new Set(seen).add(rule),
    out = new Map();
  for (const [key, p] of Object.entries(rule.properties || {})) {
    const annotations = (s, visited = new Set()) => {
      if (!s || visited.has(s)) return false;
      visited.add(s);
      return (
        !!(mode === "write" ? s.readOnly : s.writeOnly) ||
        (s.allOf || []).some((x) => annotations(x, visited))
      );
    };
    if (annotations(p)) out.set(key, true);
  }
  for (const branch of rule.allOf || [])
    for (const [key] of directions(branch, value, mode, depth + 1, next, choices))
      out.set(key, true);
  for (const branch of choices ? [...(rule.anyOf || []), ...(rule.oneOf || [])] : []) {
    if (validSchema(branch, value, mode, depth + 1))
      for (const [key] of directions(branch, value, mode, depth + 1, next))
        out.set(key, true);
  }
  return out;
}
export function validSchema(
  rule,
  value,
  mode = "write",
  depth = 0,
  inherited = new Map(),
) {
  if (value === undefined) return false;
  if (!rule || typeof rule !== "object") return true;
  if (depth > 128) throw new Error("STANDARD_SCHEMA_DEPTH_BUDGET");
  const unconditional = new Map([
    ...inherited,
    ...directions(rule, value, mode, depth, new Set(), false),
  ]);
  const annotations = new Map([...unconditional,...directions(rule,value,mode,depth)]);
  const check = (s, v) => validSchema(s, v, mode, depth + 1);
  const same = (s) => validSchema(s, value, mode, depth + 1, unconditional);
  if (rule.enum && !rule.enum.some((x) => equal(x, value))) return false;
  const t =
    value === null
      ? "null"
      : numeric(value)
        ? "number"
        : Array.isArray(value)
          ? "array"
          : typeof value;
  if (
    rule.type &&
    !(value === null && rule.nullable) &&
    !(rule.type === "integer"
      ? t === "number" && decimal(value)[1] >= 0
      : rule.type === t)
  )
    return false;
  if (rule.allOf && !rule.allOf.every(same)) return false;
  if (rule.anyOf && !rule.anyOf.some(same)) return false;
  if (rule.oneOf && rule.oneOf.filter(same).length !== 1) return false;
  if (rule.not && check(rule.not, value)) return false;
  if (t === "number") {
    if (
      rule.minimum !== undefined &&
      compare(value, rule.minimum) < (rule.exclusiveMinimum ? 1 : 0)
    )
      return false;
    if (
      rule.maximum !== undefined &&
      compare(value, rule.maximum) > (rule.exclusiveMaximum ? -1 : 0)
    )
      return false;
    if (rule.multipleOf !== undefined) {
      const [a, e] = decimal(value),
        [b, f] = decimal(rule.multipleOf),
        z = Math.min(e, f);
      if (
        b <= 0n ||
        (a * 10n ** BigInt(e - z)) % (b * 10n ** BigInt(f - z)) !== 0n
      )
        return false;
    }
    if (["int32", "int64"].includes(rule.format)) {
      const max =
        rule.format === "int32" ? "2147483647" : "9223372036854775807";
      const min =
        rule.format === "int32" ? "-2147483648" : "-9223372036854775808";
      if (
        decimal(value)[1] < 0 ||
        compare(value, number(min)) < 0 ||
        compare(value, number(max)) > 0
      )
        return false;
    }
    if (["float", "double"].includes(rule.format)) {
      const max = number(
        rule.format === "float"
          ? "3.4028234663852886e38"
          : "1.7976931348623157e308",
      );
      if (
        compare(value, max) > 0 ||
        compare(value, number("-" + String(max))) < 0
      )
        return false;
    }
  }
  if (t === "string") {
    const n = Array.from(value).length;
    if (
      (rule.minLength !== undefined && compare(n, rule.minLength) < 0) ||
      (rule.maxLength !== undefined && compare(n, rule.maxLength) > 0)
    )
      return false;
    if (
      rule.pattern &&
      !new RegExp(
        rule.pattern instanceof RegExp ? rule.pattern.source : rule.pattern,
      ).test(value)
    )
      return false;
    if (
      rule.format === "byte" &&
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        value,
      )
    )
      return false;
    if (rule.format && ajv.formats[rule.format]) {
      if (!formats.has(rule.format))
        formats.set(
          rule.format,
          ajv.compile({ type: "string", format: rule.format }),
        );
      if (!formats.get(rule.format)(value)) return false;
    }
  }
  if (t === "array") {
    if (
      (rule.minItems !== undefined &&
        compare(value.length, rule.minItems) < 0) ||
      (rule.maxItems !== undefined && compare(value.length, rule.maxItems) > 0)
    )
      return false;
    if (
      rule.uniqueItems &&
      value.some((x, i) => value.slice(0, i).some((y) => equal(x, y)))
    )
      return false;
    if (rule.items && !value.every((x) => check(rule.items, x))) return false;
  }
  if (t === "object") {
    const keys = Object.keys(value),
      props = rule.properties || {};
    if (
      (rule.minProperties !== undefined &&
        compare(keys.length, rule.minProperties) < 0) ||
      (rule.maxProperties !== undefined &&
        compare(keys.length, rule.maxProperties) > 0)
    )
      return false;
    for (const k of rule.required || []) {
      if (annotations.has(k)) continue;
      if (!Object.hasOwn(value, k)) return false;
    }
    for (const k of keys) {
      if (annotations.has(k)) return false;
      if (Object.hasOwn(props, k)) {
        const p = props[k];
        if (
          (mode === "write" && p.readOnly) ||
          (mode === "read" && p.writeOnly) ||
          !check(p, value[k])
        )
          return false;
      } else if (
        rule.additionalProperties === false ||
        (typeof rule.additionalProperties === "object" &&
          !check(rule.additionalProperties, value[k]))
      )
        return false;
    }
  }
  // Discriminator is a selection hint, not an extra validation constraint (3.0.4).
  return true;
}
export function effective(rule, value, seen = new Set()) {
  if (!rule || seen.has(rule)) return {};
  seen.add(rule);
  const out = {
    ...rule,
    properties: { ...rule.properties },
    required: [...(rule.required || [])],
  };
  const branches = [...(rule.allOf || [])];
  const choices = rule.oneOf || rule.anyOf || [];
  if (choices.length)
    branches.push(
      choices.find((s) => value !== undefined && validSchema(s, value)) ||
        choices[0],
    );
  for (const b of branches) {
    const p = effective(b, value, seen);
    for (const [k, v] of Object.entries(p.properties))
      setOwn(out.properties, k, v);
    out.required.push(...(p.required || []));
    out.type ??= p.type;
    out.xml ??= p.xml;
  }
  return out;
}
export function directed(
  rule,
  seed = 0,
  depth = 0,
  seen = new Set(),
  mode = "write",
) {
  if (!rule || depth > 12 || seen.has(rule)) return undefined;
  const next = new Set(seen).add(rule);
  for (const v of [rule.example, rule.default, ...(rule.enum || [])])
    if (v !== undefined && validSchema(rule, v, mode)) return cloneExact(v);
  for (const branch of rule.oneOf || rule.anyOf || []) {
    const v = directed(branch, seed, depth + 1, next, mode);
    if (v !== undefined && validSchema(rule, v, mode)) return v;
  }
  for (const branch of rule.allOf || []) {
    const v = directed(branch, seed, depth + 1, next, mode);
    if (v !== undefined && validSchema(rule, v, mode)) return v;
  }
  const s = effective(rule);
  let v;
  if (
    s.type === "object" ||
    (s.properties && Object.keys(s.properties).length)
  ) {
    v = {};
    for (const [k, p] of Object.entries(s.properties || {})) {
      if (mode === "write" ? p.readOnly : p.writeOnly) continue;
      const x = directed(p, seed, depth + 1, next, mode);
      if (x !== undefined) setOwn(v, k, x);
    }
    if (
      rule.discriminator &&
      !Object.hasOwn(v, rule.discriminator.propertyName)
    ) {
      const mapping = Object.keys(rule.discriminator.mapping || {});
      if (mapping.length)
        setOwn(
          v,
          rule.discriminator.propertyName,
          mapping[seed % mapping.length],
        );
    }
    for (
      let i = Object.keys(v).length;
      i < Math.min(Number(s.minProperties || 0), 32);
      i++
    )
      setOwn(
        v,
        "generated" + i,
        directed(
          typeof s.additionalProperties === "object"
            ? s.additionalProperties
            : {},
          seed,
          depth + 1,
          next,
        ) ?? "sample",
      );
  } else if (s.type === "array") {
    v = Array.from(
      { length: Math.min(Number(s.minItems || 0), 32) },
      (_, i) => directed(s.items, seed + i, depth + 1, next, mode) ?? null,
    );
  } else if (["number", "integer"].includes(s.type)) {
    const candidate = s.minimum ?? s.maximum ?? 0,
      lower = s.minimum !== undefined || s.maximum === undefined;
    let step = s.multipleOf || (s.type === "integer" ? 1 : number("0.1"));
    if (s.type === "integer") {
      const [a, e] = decimal(step);
      if (e < 0) {
        let x = a,
          y = 10n ** BigInt(-e);
        while (y) {
          const r = x % y;
          x = y;
          y = r;
        }
        step = number(String(a / x));
      }
    }
    const [n, e] = decimal(candidate),
      [a, f] = decimal(step),
      z = Math.min(e, f),
      x = n * 10n ** BigInt(e - z),
      unit = a * 10n ** BigInt(f - z);
    let q = x / unit;
    if ((lower && x % unit > 0n) || (!lower && x % unit < 0n))
      q += lower ? 1n : -1n;
    if (x % unit === 0n && (lower ? s.exclusiveMinimum : s.exclusiveMaximum))
      q += lower ? 1n : -1n;
    v = number(String(q * unit) + (z ? "e" + z : ""));
  } else if (s.type === "boolean") v = false;
  else if (s.type === "string" || !s.type)
    v =
      {
        date: "2000-01-01",
        "date-time": "2000-01-01T00:00:00Z",
        uri: "https://example.invalid/",
        uuid: "00000000-0000-4000-8000-000000000000",
        email: "synthetic@example.invalid",
        ipv4: "127.0.0.1",
        ipv6: "::1",
        hostname: "example.invalid",
      }[s.format] ?? "a".repeat(Math.min(Number(s.minLength || 0), 4096));
  if (v !== undefined && validSchema(rule, v, mode)) return v;
  return undefined;
}

// Exact 2020-12 probe: Ajv validates schema metadata; evaluation retains original
// decimals and explicit property/index sets. No network or filesystem resolver.
import Ajv2020 from "ajv/dist/2020.js";
import formats from "ajv-formats/dist/formats.js";
import {
  numeric,
  decimal,
  compare,
  equal,
  shadow,
} from "../../platform/standard-value.mjs";
import {
  specializeModernResources,
  MODERN_DIALECTS,
} from "../../platform/modern-resources.mjs";
const metadata = new Ajv2020({
  strictSchema: false,
  strictTypes: false,
  strictTuples: false,
  strictRequired: false,
  validateFormats: false,
  logger: false,
  ownProperties: true,
}).getSchema(MODERN_DIALECTS[0]);

const singles = [
  "not",
  "if",
  "then",
  "else",
  "items",
  "contains",
  "propertyNames",
  "additionalProperties",
  "unevaluatedProperties",
  "unevaluatedItems",
  "contentSchema",
];
const arrays = ["allOf", "anyOf", "oneOf", "prefixItems"];
const maps = [
  "$defs",
  "definitions",
  "properties",
  "patternProperties",
  "dependentSchemas",
];
const counts = [
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "minContains",
  "maxContains",
  "minProperties",
  "maxProperties",
];
const bounds = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
];
const vocabulary = new Set(
  [
    "core",
    "applicator",
    "unevaluated",
    "validation",
    "meta-data",
    "format-annotation",
    "content",
  ].map((v) => "https://json-schema.org/draft/2020-12/vocab/" + v),
);
vocabulary.add("https://spec.openapis.org/oas/3.1/vocab/base");
vocabulary.add("https://spec.openapis.org/oas/3.2/vocab/base");
const binary = (value) => Buffer.isBuffer(value) || value instanceof Uint8Array;
const invalid = () => {
  throw new Error("MODERN_SCHEMA_INVALID_OR_UNGRANTED");
};
const budget = () => {
  throw new Error("MODERN_SCHEMA_RESOURCE_BUDGET");
};
const has = (o, k) => Object.hasOwn(o, k);
const escape = (s) => s.replace(/~/g, "~0").replace(/\//g, "~1");
function bounded(value, state = { nodes: 0 }, depth = 0) {
  if (++state.nodes > 50000 || depth > 64) budget();
  if (binary(value)) {
    if (value.byteLength > 1048576) budget();
  } else if (numeric(value)) {
    const [coefficient, exponent] = decimal(value);
    if (
      String(coefficient < 0n ? -coefficient : coefficient).length > 4096 ||
      Math.abs(exponent) > 10000
    )
      throw new Error("MODERN_SCHEMA_NUMBER_BUDGET");
  } else if (value && typeof value === "object")
    for (const v of Object.values(value)) bounded(v, state, depth + 1);
}
function canonical(value) {
  if (binary(value)) return "b" + Buffer.from(value).toString("hex");
  if (numeric(value)) {
    const [c, e] = decimal(value);
    return "n" + c + "e" + e;
  }
  if (value === null) return "z";
  if (typeof value === "string") return "s" + JSON.stringify(value);
  if (typeof value === "boolean") return value ? "t" : "f";
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.keys(value)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
      .join(",") +
    "}"
  );
}
const type = (v) =>
  v === null
    ? "null"
    : binary(v)
      ? "binary"
      : numeric(v)
        ? "number"
        : Array.isArray(v)
          ? "array"
          : typeof v;
function numericRule(rule, value) {
  if (has(rule, "minimum") && compare(value, rule.minimum) < 0) return false;
  if (has(rule, "maximum") && compare(value, rule.maximum) > 0) return false;
  if (
    has(rule, "exclusiveMinimum") &&
    compare(value, rule.exclusiveMinimum) <= 0
  )
    return false;
  if (
    has(rule, "exclusiveMaximum") &&
    compare(value, rule.exclusiveMaximum) >= 0
  )
    return false;
  if (has(rule, "multipleOf")) {
    const [a, e] = decimal(value),
      [b, f] = decimal(rule.multipleOf),
      z = Math.min(e, f);
    if ((a * 10n ** BigInt(e - z)) % (b * 10n ** BigInt(f - z)) !== 0n)
      return false;
  }
  return true;
}
function openAPIAnnotations(schema, dialect) {
  const modern = dialect.replace(/#$/, "");
  if (!modern.startsWith("https://spec.openapis.org/oas/")) return;
  const v32 = modern.includes("/3.2/");
  const record = (value, allowed) =>
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !numeric(value) &&
    Object.keys(value).every(
      (key) => allowed.includes(key) || key.startsWith("x-"),
    );
  const stringFields = (value, names) =>
    names.every((name) => !has(value, name) || typeof value[name] === "string");
  if (has(schema, "xml")) {
    const xml = schema.xml;
    if (
      !record(xml, [
        "name",
        "namespace",
        "prefix",
        "attribute",
        "wrapped",
        ...(v32 ? ["nodeType"] : []),
      ]) ||
      !stringFields(xml, ["name", "namespace", "prefix"]) ||
      ["attribute", "wrapped"].some(
        (name) => has(xml, name) && typeof xml[name] !== "boolean",
      )
    )
      invalid();
    if (
      has(xml, "namespace") &&
      (!/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(xml.namespace) ||
        /[\s\u0000-\u001f<>"{}|\\^`]/u.test(xml.namespace))
    )
      invalid();
    if (
      has(xml, "nodeType") &&
      (!["element", "attribute", "text", "cdata", "none"].includes(
        xml.nodeType,
      ) ||
        has(xml, "attribute") ||
        has(xml, "wrapped"))
    )
      invalid();
  }
  if (has(schema, "externalDocs")) {
    const docs = schema.externalDocs;
    if (
      !record(docs, ["url", "description"]) ||
      typeof docs.url !== "string" ||
      !stringFields(docs, ["description"]) ||
      /[\s\u0000-\u001f<>"{}|\\^`]/u.test(docs.url)
    )
      invalid();
  }
  if (has(schema, "discriminator")) {
    const d = schema.discriminator;
    if (
      !record(d, [
        "propertyName",
        "mapping",
        ...(v32 ? ["defaultMapping"] : []),
      ]) ||
      typeof d.propertyName !== "string" ||
      !stringFields(d, ["defaultMapping"])
    )
      invalid();
    if (
      has(d, "mapping") &&
      (!d.mapping ||
        typeof d.mapping !== "object" ||
        Array.isArray(d.mapping) ||
        numeric(d.mapping) ||
        Object.values(d.mapping).some((value) => typeof value !== "string"))
    )
      invalid();
  }
}
export function compileExactModern(schema, documents = {}, options = {}) {
  const {
    assertFormats = false,
    schemaRegistry = {},
    schemaDialects,
    rootURI,
    dialect = MODERN_DIALECTS[0],
    mode = "annotation",
    directionPolicy = "annotation",
  } = options;
  if (
    typeof assertFormats !== "boolean" ||
    !["annotation", "write", "read"].includes(mode) ||
    !["annotation", "reject-forbidden"].includes(directionPolicy)
  )
    throw new Error("MODERN_SCHEMA_OPTIONS");
  if (schemaDialects !== undefined && typeof schemaDialects?.get !== "function")
    throw new Error("MODERN_SCHEMA_OPTIONS");
  const registry =
    schemaRegistry instanceof Map
      ? [...schemaRegistry.values()]
      : Object.values(schemaRegistry ?? {});
  if (
    !schemaRegistry ||
    typeof schemaRegistry !== "object" ||
    Array.isArray(schemaRegistry) ||
    registry.length > 4096
  )
    throw new Error("MODERN_SCHEMA_REFERENCES");
  if (
    !documents ||
    Array.isArray(documents) ||
    typeof documents !== "object" ||
    Object.keys(documents).length > 16
  )
    throw new Error("MODERN_SCHEMA_REFERENCES");
  const regexes = new Map();
  const regex = (pattern) => {
    if (!regexes.has(pattern)) regexes.set(pattern, new RegExp(pattern, "u"));
    return regexes.get(pattern);
  };
  const check = (s, contextDialect = dialect) => {
    if (typeof s === "boolean") return;
    const selected = schemaDialects?.get(s);
    contextDialect =
      s.$schema ??
      (typeof selected === "string" ? selected : selected?.dialect) ??
      contextDialect;
    openAPIAnnotations(s, contextDialect);
    for (const k of counts)
      if (
        has(s, k) &&
        (!numeric(s[k]) || compare(s[k], 0) < 0 || decimal(s[k])[1] < 0)
      )
        invalid();
    for (const k of bounds)
      if (
        has(s, k) &&
        (!numeric(s[k]) || (k === "multipleOf" && compare(s[k], 0) <= 0))
      )
        invalid();
    for (const [uri, required] of Object.entries(s.$vocabulary ?? {}))
      if (required && !vocabulary.has(uri))
        throw new Error("MODERN_SCHEMA_DIALECT_UNSUPPORTED");
    if (
      assertFormats &&
      has(s, "format") &&
      !has(formats.fullFormats, s.format)
    )
      throw new Error("MODERN_SCHEMA_FORMAT_UNSUPPORTED");
    if (has(s, "pattern")) regex(s.pattern);
    for (const pattern of Object.keys(s.patternProperties ?? {}))
      regex(pattern);
    for (const k of singles) if (has(s, k)) check(s[k], contextDialect);
    for (const k of arrays)
      for (const child of s[k] ?? []) check(child, contextDialect);
    for (const k of maps)
      for (const child of Object.values(s[k] ?? {}))
        check(child, contextDialect);
  };
  for (const original of [schema, ...Object.values(documents), ...registry]) {
    bounded(original);
    // Use the known 2020-12 meta-schema directly, not original.$schema as a
    // loader address. OAS base dialects add annotation vocabularies; they do
    // not change the JSON Schema validation keyword syntax.
    if (!metadata(shadow(original))) invalid();
    check(original);
  }
  const normalized = specializeModernResources(schema, documents, {
    schemaRegistry,
    rootURI,
    dialect,
  });
  const validFormat = (name, value) => {
    if (["int32", "int64"].includes(name)) {
      if (!numeric(value)) return true;
      const limit = 2n ** (name === "int32" ? 31n : 63n);
      return (
        decimal(value)[1] >= 0 &&
        compare(value, String(-limit)) >= 0 &&
        compare(value, String(limit - 1n)) <= 0
      );
    }
    const definition = formats.fullFormats[name];
    if (definition === true) return true;
    const expected = definition.type ?? "string";
    if (type(value) !== expected) return true;
    const fn = definition.validate ?? definition;
    return fn instanceof RegExp
      ? fn.test(value)
      : fn(expected === "number" ? Number(String(value)) : value);
  };
  return (value) => {
    bounded(value);
    let operations = 0;
    const active = new Set();
    const evaluate = (s, data, path = "", kind = "value", depth = 0) => {
      if (++operations > 200000 || depth > 256) budget();
      const result = {
        valid: true,
        props: new Set(),
        items: new Set(),
        errors: [],
      };
      const fail = (keyword) => {
        result.valid = false;
        if (result.errors.length < 16) result.errors.push(keyword);
      };
      // Annotations of an unsuccessful branch must never authorize data in its
      // sibling unevaluated* keyword. Child-instance annotations stay local.
      const merge = (r) => {
        if (!r.valid) return;
        for (const p of r.props) result.props.add(p);
        for (const i of r.items) result.items.add(i);
      };
      const child = (sub, v = data, suffix = "", childKind = kind) =>
        evaluate(sub, v, path + suffix, childKind, depth + 1);
      if (s === false) fail("false schema");
      else if (s !== true) {
        if (s.$ref) {
          if (!has(normalized.documents, s.$ref)) invalid();
          const key = JSON.stringify([s.$ref, path, kind]);
          if (active.has(key)) budget(); // unproductive same-instance cycle
          active.add(key);
          const r = child(normalized.documents[s.$ref]);
          active.delete(key);
          if (!r.valid) fail("$ref");
          else merge(r);
        }
        const t = type(data);
        if (s.type !== undefined) {
          const ts = Array.isArray(s.type) ? s.type : [s.type];
          if (
            !ts.some(
              (x) =>
                x === t ||
                (x === "integer" && t === "number" && decimal(data)[1] >= 0),
            )
          )
            fail("type");
        }
        if (
          directionPolicy === "reject-forbidden" &&
          ((mode === "write" && s.readOnly === true) ||
            (mode === "read" && s.writeOnly === true))
        )
          fail("direction");
        if (has(s, "const") && (binary(data) || !equal(data, s.const)))
          fail("const");
        if (s.enum && (binary(data) || !s.enum.some((v) => equal(data, v))))
          fail("enum");
        if (numeric(data) && !numericRule(s, data)) fail("numeric");
        if (assertFormats && s.format && !validFormat(s.format, data))
          fail("format");
        if (typeof data === "string") {
          const length = [...data].length;
          if (has(s, "minLength") && compare(length, s.minLength) < 0)
            fail("minLength");
          if (has(s, "maxLength") && compare(length, s.maxLength) > 0)
            fail("maxLength");
          if (has(s, "pattern") && !regex(s.pattern).test(data))
            fail("pattern");
        }
        if (s.allOf)
          for (const sub of s.allOf) {
            const r = child(sub);
            if (!r.valid) fail("allOf");
            else merge(r);
          }
        for (const name of ["anyOf", "oneOf"])
          if (s[name]) {
            const passing = s[name]
              .map((sub) => child(sub))
              .filter((r) => r.valid);
            if (!passing.length || (name === "oneOf" && passing.length !== 1))
              fail(name);
            else for (const r of passing) merge(r);
          }
        if (has(s, "not") && child(s.not).valid) fail("not");
        if (has(s, "if")) {
          const condition = child(s.if);
          if (condition.valid) merge(condition);
          const branch = condition.valid ? "then" : "else";
          if (has(s, branch)) {
            const r = child(s[branch]);
            if (!r.valid) fail(branch);
            else merge(r);
          }
        }
        if (t === "object") {
          const keys = Object.keys(data),
            matched = new Set();
          if (
            has(s, "minProperties") &&
            compare(keys.length, s.minProperties) < 0
          )
            fail("minProperties");
          if (
            has(s, "maxProperties") &&
            compare(keys.length, s.maxProperties) > 0
          )
            fail("maxProperties");
          for (const k of s.required ?? []) if (!has(data, k)) fail("required");
          const property = (sub, k, name) => {
            if (!child(sub, data[k], "/" + escape(k)).valid) fail(name);
            else result.props.add(k);
          };
          for (const [k, sub] of Object.entries(s.properties ?? {}))
            if (has(data, k)) {
              matched.add(k);
              property(sub, k, "properties");
            }
          for (const [pattern, sub] of Object.entries(
            s.patternProperties ?? {},
          ))
            for (const k of keys)
              if (regex(pattern).test(k)) {
                matched.add(k);
                property(sub, k, "patternProperties");
              }
          if (has(s, "additionalProperties"))
            for (const k of keys)
              if (!matched.has(k))
                property(s.additionalProperties, k, "additionalProperties");
          if (has(s, "propertyNames"))
            for (const k of keys)
              if (
                !child(s.propertyNames, k, "/" + escape(k), "propertyName")
                  .valid
              )
                fail("propertyNames");
          for (const [k, names] of Object.entries(s.dependentRequired ?? {}))
            if (has(data, k))
              for (const name of names)
                if (!has(data, name)) fail("dependentRequired");
          for (const [k, sub] of Object.entries(s.dependentSchemas ?? {}))
            if (has(data, k)) {
              const r = child(sub);
              if (!r.valid) fail("dependentSchemas");
              else merge(r);
            }
          if (has(s, "unevaluatedProperties"))
            for (const k of keys)
              if (!result.props.has(k))
                property(s.unevaluatedProperties, k, "unevaluatedProperties");
        }
        if (t === "array") {
          if (has(s, "minItems") && compare(data.length, s.minItems) < 0)
            fail("minItems");
          if (has(s, "maxItems") && compare(data.length, s.maxItems) > 0)
            fail("maxItems");
          if (
            s.uniqueItems &&
            new Set(data.map(canonical)).size !== data.length
          )
            fail("uniqueItems");
          const item = (sub, i, name) => {
            if (!child(sub, data[i], "/" + i).valid) fail(name);
            else result.items.add(i);
          };
          const prefix = s.prefixItems?.length ?? 0;
          for (let i = 0; i < Math.min(prefix, data.length); i++)
            item(s.prefixItems[i], i, "prefixItems");
          if (has(s, "items"))
            for (let i = prefix; i < data.length; i++)
              item(s.items, i, "items");
          if (has(s, "contains")) {
            const passing = [];
            for (let i = 0; i < data.length; i++)
              if (child(s.contains, data[i], "/" + i).valid) passing.push(i);
            if (
              compare(passing.length, s.minContains ?? 1) < 0 ||
              (has(s, "maxContains") &&
                compare(passing.length, s.maxContains) > 0)
            )
              fail("contains");
            else for (const i of passing) result.items.add(i);
          }
          if (has(s, "unevaluatedItems"))
            for (let i = 0; i < data.length; i++)
              if (!result.items.has(i))
                item(s.unevaluatedItems, i, "unevaluatedItems");
        }
      }
      if (!result.valid) {
        result.props.clear();
        result.items.clear();
      }
      return result;
    };
    const result = evaluate(normalized.schema, value);
    return { valid: result.valid, errors: result.errors };
  };
}

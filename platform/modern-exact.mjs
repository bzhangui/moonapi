// Host: metadata, granted URI specialization, ECMA regex and format leaves.
// MoonBit owns instance evaluation, exact constraints and evaluated-location sets.
import Ajv2020 from "ajv/dist/2020.js";
import formats from "ajv-formats/dist/formats.js";
import {
  numeric,
  decimal,
  compare,
  shadow,
  parseExact,
  stringifyExact,
  setOwn,
} from "./standard-value.mjs";
import { loadCore } from "./runner.mjs";
await loadCore();
import {
  specializeModernResources,
  MODERN_DIALECTS,
} from "./modern-resources.mjs";
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
    const binaries = Object.create(null);
    const encode = (x, pointer = "") => {
      if (["undefined", "function", "symbol", "bigint"].includes(typeof x))
        throw new Error("MODERN_SCHEMA_VALUE_NOT_JSON");
      if (binary(x)) {
        binaries[pointer] = Buffer.from(x).toString("hex");
        return null;
      }
      if (!x || typeof x !== "object" || numeric(x)) return x;
      if (Array.isArray(x))
        return x.map((v, i) => encode(v, pointer + "/" + i));
      const out = Object.create(null);
      for (const [k, v] of Object.entries(x))
        setOwn(out, k, encode(v, pointer + "/" + escape(k)));
      return out;
    };
    const input = stringifyExact({
      schema: normalized.schema,
      documents: normalized.documents,
      data: encode(value),
      binaries,
      assertFormats,
      mode,
      directionPolicy,
    });
    if (Buffer.byteLength(input) > 8388608) budget();
    const result = JSON.parse(
      globalThis.__moonapi_modern(
        input,
        (p, text) => regex(p).test(text),
        (name, json) => validFormat(name, parseExact(json)),
      ),
    );
    if (result.error) throw new Error(result.error);
    return result;
  };
}

// The untrusted standards compiler and regex/random generation live in a
// disposable, memory/time-bounded worker, never in the HTTP runner event loop.
import { parentPort } from "node:worker_threads";
import SwaggerParser from "@apidevtools/swagger-parser";
import Enforcer from "openapi-enforcer";
import AjvDraft4 from "ajv-draft-04";
import addFormats from "ajv-formats";
import { parseDocument } from "yaml";

const METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
];
let api,
  definition,
  operations = new Map();
let validators = new WeakMap();
const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};
function parseSource(source) {
  const parsed = parseDocument(source, {
    version: "1.2",
    schema: "core",
    uniqueKeys: true,
    prettyErrors: false,
  });
  if (parsed.errors.length || parsed.warnings.length)
    fail("STANDARD_DOCUMENT_ENCODING");
  const value = parsed.toJS({ maxAliasCount: 20 });
  bounded(value);
  return value;
}
function bounded(value) {
  const stack = [[value, 0]],
    seen = new Set();
  let nodes = 0;
  while (stack.length) {
    const [v, depth] = stack.pop();
    if (++nodes > 50000 || depth > 64) fail("STANDARD_RESOURCE_BUDGET");
    if (v && typeof v === "object" && !seen.has(v)) {
      seen.add(v);
      for (const key of Object.keys(v)) {
        if (["__proto__", "prototype", "constructor"].includes(key))
          fail("STANDARD_UNSAFE_KEY");
        stack.push([v[key], depth + 1]);
      }
    }
  }
}
function jsonValue(value) {
  if (value === undefined) return undefined;
  const out = JSON.stringify(value);
  if (Buffer.byteLength(out) > 262144) fail("STANDARD_VALUE_BUDGET");
  return JSON.parse(out);
}
function validator(schema, mode) {
  let modes = validators.get(schema);
  if (!modes) {
    modes = new Map();
    validators.set(schema, modes);
  }
  if (modes.has(mode)) return modes.get(mode);
  const definitions = {},
    ids = new WeakMap();
  const convert = (rule) => {
    if (ids.has(rule)) return { $ref: "#/definitions/" + ids.get(rule) };
    const id = "s" + idsCount++;
    if (idsCount > 4096) fail("STANDARD_SCHEMA_BUDGET");
    ids.set(rule, id);
    const out = (definitions[id] = {});
    for (const key of [
      "type",
      "enum",
      "multipleOf",
      "maximum",
      "minimum",
      "exclusiveMaximum",
      "exclusiveMinimum",
      "minLength",
      "maxLength",
      "pattern",
      "minItems",
      "maxItems",
      "uniqueItems",
      "minProperties",
      "maxProperties",
      "format",
    ]) {
      if (Object.hasOwn(rule, key))
        out[key] =
          key === "pattern" && rule[key] instanceof RegExp
            ? rule[key].source
            : jsonValue(rule[key]);
    }
    if (rule.nullable && typeof out.type === "string")
      out.type = [out.type, "null"];
    for (const key of ["allOf", "oneOf", "anyOf"])
      if (rule[key]) out[key] = rule[key].map(convert);
    for (const key of ["items", "not"])
      if (rule[key]) out[key] = convert(rule[key]);
    if (rule.properties) {
      out.properties = {};
      for (const [key, prop] of Object.entries(rule.properties)) {
        out.properties[key] =
          (mode === "write" && prop.readOnly) ||
          (mode === "read" && prop.writeOnly)
            ? { not: {} }
            : convert(prop);
      }
    }
    if (rule.required?.length)
      out.required = rule.required.filter((key) => {
        const prop = rule.properties?.[key];
        return (
          !(mode === "write" && prop?.readOnly) &&
          !(mode === "read" && prop?.writeOnly)
        );
      });
    if (out.required?.length === 0) delete out.required;
    if (typeof rule.additionalProperties === "boolean")
      out.additionalProperties = rule.additionalProperties;
    else if (rule.additionalProperties)
      out.additionalProperties = convert(rule.additionalProperties);
    return { $ref: "#/definitions/" + id };
  };
  let idsCount = 0;
  const root = convert(schema);
  const ajv = new AjvDraft4({
    strict: false,
    validateFormats: true,
    allErrors: false,
    logger: false,
  });
  addFormats(ajv);
  ajv.addFormat("int32", {
    type: "number",
    validate: (n) => Number.isInteger(n) && n >= -2147483648 && n <= 2147483647,
  });
  ajv.addFormat("int64", {
    type: "number",
    validate: (n) => Number.isSafeInteger(n),
  });
  ajv.addFormat("byte", {
    type: "string",
    validate: (s) =>
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        s,
      ),
  });
  for (const name of ["binary", "password", "float", "double"])
    ajv.addFormat(name, true);
  const fn = ajv.compile({ ...root, definitions });
  modes.set(mode, fn);
  return fn;
}
function validate(schema, value, mode = "write") {
  if (!schema) return true;
  return validator(schema, mode)(value);
}
function sample(schema, examples, seed) {
  if (!schema) return examples[0] ?? "sample";
  for (const candidate of examples) {
    if (candidate !== undefined) {
      const projected = projectRequest(schema, jsonValue(candidate));
      if (validate(schema, projected)) return projected;
    }
  }
  let state = seed + 1;
  const random = Math.random;
  Math.random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  try {
    const candidates = [null, {}, [], "", "sample", 0, 1, true, false];
    // Enforcer is only a candidate generator. Its known composite/AND
    // limitations must not reject an otherwise legal OpenAPI document or
    // decide contract validity. Independent raw-schema validation is mandatory.
    const [generator, generationError] = Enforcer.v3_0.Schema(
      structuredClone(schema),
    );
    for (let i = 0; !generationError && i < 24; i++) {
      const [value, error] = generator.random(undefined, {
        maxDepth: 8,
        arrayVariation: 2,
        numberVariation: 10,
        definedPropertyPossibility: 0.5,
        defaultPossibility: 0.5,
        uniqueItemRetry: 8,
      });
      if (!error) {
        // Serialization also projects direction-only properties.
        const [serialized, serialError] = generator.serialize(value, {
          readWriteMode: "write",
        });
        if (!serialError) {
          const projected = projectRequest(schema, jsonValue(serialized));
          if (validate(schema, projected)) return projected;
        }
      }
    }
    for (const candidate of candidates)
      if (validate(schema, candidate)) return candidate;
  } finally {
    Math.random = random;
  }
  fail("STANDARD_GENERATION_UNSAT_OR_BUDGET");
}
function projectRequest(schema, value, depth = 0) {
  if (!schema || depth > 16 || value === null || typeof value !== "object")
    return value;
  for (const rule of [
    ...(schema.allOf ?? []),
    ...(schema.oneOf ?? []),
    ...(schema.anyOf ?? []),
  ])
    value = projectRequest(rule, value, depth + 1);
  if (Array.isArray(value))
    return value.map((v) => projectRequest(schema.items, v, depth + 1));
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    if (prop.readOnly) delete value[key];
    else if (Object.hasOwn(value, key))
      value[key] = projectRequest(prop, value[key], depth + 1);
  }
  return value;
}
function exampleValues(node) {
  return [
    node?.example,
    ...Object.values(node?.examples ?? {}).map((e) => e?.value),
    node?.schema?.example,
    node?.schema?.default,
  ];
}
// Constraint-directed candidates complement library sampling. Each candidate is
// independently validated before its valid/invalid label is assigned.
function boundaryValues(schema, value, depth = 0) {
  if (!schema || depth > 3) return [];
  const out = [...(schema.enum ?? [])];
  if (typeof value === "number") {
    const step = schema.multipleOf ?? (schema.type === "integer" ? 1 : 0.5);
    out.push(0, value - step, value + step);
    if (schema.minimum !== undefined)
      out.push(schema.minimum, schema.minimum - step, schema.minimum + step);
    if (schema.maximum !== undefined)
      out.push(schema.maximum, schema.maximum - step, schema.maximum + step);
  } else if (typeof value === "string") {
    for (const n of [schema.minLength, schema.maxLength])
      if (Number.isInteger(n) && n <= 4096) {
        for (const size of [Math.max(0, n - 1), n, n + 1])
          out.push((Array.from(value)[0] ?? "a").repeat(size));
      }
    if (schema.format || schema.pattern || schema.enum)
      out.push("moonapi-invalid-value");
  } else if (Array.isArray(value)) {
    for (const n of [schema.minItems, schema.maxItems])
      if (Number.isInteger(n) && n <= 32) {
        for (const size of [Math.max(0, n - 1), n, n + 1])
          out.push(
            Array.from(
              { length: size },
              (_, i) => value[i % Math.max(value.length, 1)] ?? "sample",
            ),
          );
      }
    if (value.length) out.push([value[0], value[0]]);
  } else if (value && typeof value === "object") {
    const properties = { ...schema.properties };
    for (const branch of schema.allOf ?? [])
      Object.assign(properties, branch.properties);
    for (const key of Object.keys(value).slice(0, 8)) {
      const without = { ...value };
      delete without[key];
      out.push(without);
      for (const candidate of boundaryValues(
        properties[key],
        value[key],
        depth + 1,
      ).slice(0, 12))
        out.push({ ...value, [key]: candidate });
    }
    if (schema.additionalProperties === false)
      out.push({ ...value, moonapi_additional_field: "synthetic" });
  }
  return out;
}
function metadata(id, op, item) {
  const body = op.requestBody;
  const security = op.security ?? definition.security ?? [];
  const blockers = [];
  if (op.__moonapi_method === "trace") blockers.push("trace_transport_pending");
  const scanned = new Set(),
    stack = [
      op.requestBody,
      ...op.allParameters,
      ...Object.values(op.responses),
    ];
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== "object" || scanned.has(value)) continue;
    scanned.add(value);
    if (value.discriminator)
      blockers.push("discriminator_interactions_pending");
    for (const v of Object.values(value))
      if (v && typeof v === "object") stack.push(v);
  }
  if (Object.keys(op.callbacks ?? {}).length)
    blockers.push("callbacks_execution_pending");
  for (const response of Object.values(op.responses)) {
    if (Object.keys(response.links ?? {}).length)
      blockers.push("links_execution_pending");
    if (Object.keys(response.content ?? {}).some((m) => /xml/i.test(m)))
      blockers.push("xml_contract_pending");
  }
  const media = Object.keys(body?.content ?? {});
  if (media.some((m) => /xml/i.test(m))) blockers.push("xml_encoding_pending");
  if (media.some((m) => m.includes("*")))
    blockers.push("request_media_selection_pending");
  if (
    Object.values(body?.content ?? {}).some(
      (m) => Object.keys(m.encoding ?? {}).length,
    )
  )
    blockers.push("custom_encoding_pending");
  return {
    id,
    method: "", // overwritten by compiler
    parameters: op.allParameters.map((p) => ({
      name: p.name,
      in: p.in,
      required: p.required ?? false,
      style: p.style,
      explode: p.explode,
      allowReserved: p.allowReserved ?? false,
      content: Object.keys(p.content ?? {})[0],
    })),
    request_media: media,
    binary_fields: Object.fromEntries(
      media.map((m) => [
        m,
        Object.entries(body.content[m].schema?.properties ?? {})
          .filter(([, p]) => p.format === "binary")
          .map(([k]) => k),
      ]),
    ),
    servers: jsonValue(
      op.servers ?? item.servers ?? definition.servers ?? [{ url: "/" }],
    ),
    security: jsonValue(security),
    security_schemes: jsonValue(definition.components?.securitySchemes ?? {}),
    blockers: [...new Set(blockers)],
  };
}
async function compile({ source, documents = {} }) {
  const doc = parseSource(source);
  bounded(doc);
  if (!/^3\.0\.\d+$/.test(doc.openapi ?? ""))
    fail("STANDARD_OPENAPI_3_0_REQUIRED");
  if (Object.keys(documents).length > 16) fail("STANDARD_REFERENCE_BUDGET");
  let bytes = Buffer.byteLength(source);
  const refs = new Map();
  for (const [uri, content] of Object.entries(documents)) {
    const u = new URL(uri);
    if (
      !["https:", "http:"].includes(u.protocol) ||
      u.username ||
      u.password ||
      u.hash
    )
      fail("STANDARD_REFERENCE_URI");
    bytes += Buffer.byteLength(content);
    if (bytes > 4194304) fail("STANDARD_REFERENCE_BUDGET");
    const parsed = parseSource(content);
    refs.set(u.href, parsed);
  }
  // No ambient file/network access. External refs require exact document grants.
  const parser = new SwaggerParser();
  const resolver = {
    file: false,
    http: false,
    granted: {
      order: 1,
      canRead: () => true,
      read: (file) => {
        const url = new URL(file.url);
        url.hash = "";
        if (!refs.has(url.href)) fail("STANDARD_REFERENCE_NOT_GRANTED");
        return JSON.stringify(refs.get(url.href));
      },
    },
  };
  const bundle = await parser.bundle(
    "https://moonapi.invalid/openapi.json",
    doc,
    { resolve: resolver },
  );
  api = await SwaggerParser.validate(bundle, {
    resolve: { external: false, file: false, http: false },
  });
  validators = new WeakMap();
  definition = api;
  operations = new Map();
  const summaries = [];
  for (const route of Object.keys(api.paths).sort()) {
    const item = api.paths[route];
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;
      op.__moonapi_method = method;
      const merged = new Map();
      for (const list of [item.parameters ?? [], op.parameters ?? []]) {
        const seen = new Set();
        for (const p of list) {
          const key =
            p.in + ":" + (p.in === "header" ? p.name.toLowerCase() : p.name);
          if (seen.has(key)) fail("STANDARD_DUPLICATE_PARAMETER");
          seen.add(key);
          merged.set(key, p);
          if (!p.schema && p.content)
            p.schema = p.content[Object.keys(p.content)[0]]?.schema;
        }
      }
      op.allParameters = [...merged.values()].filter(
        (p) =>
          !(
            p.in === "header" &&
            ["accept", "content-type", "authorization"].includes(
              p.name.toLowerCase(),
            )
          ),
      );
      for (const name of route.matchAll(/\{([^{}]+)\}/g)) {
        if (
          !op.allParameters.some(
            (p) => p.name === name[1] && p.in === "path" && p.required,
          )
        )
          fail("STANDARD_PATH_PARAMETER_REQUIRED");
      }
      for (const p of op.allParameters)
        if (p.in === "path" && !route.includes("{" + p.name + "}"))
          fail("STANDARD_PATH_PARAMETER_UNUSED");
      for (const requirement of op.security ?? api.security ?? []) {
        for (const [name, scopes] of Object.entries(requirement)) {
          const scheme = api.components?.securitySchemes?.[name];
          if (
            !scheme ||
            (!["oauth2", "openIdConnect"].includes(scheme.type) &&
              scopes.length)
          )
            fail("STANDARD_SECURITY_REQUIREMENT");
        }
      }
      const id = op.operationId || method.toUpperCase() + " " + route;
      if (operations.has(id) || id.length > 256)
        fail("STANDARD_DUPLICATE_OPERATION");
      operations.set(id, { op, route, method });
      summaries.push({
        ...metadata(id, op, item),
        method: method.toUpperCase(),
        path: route,
      });
      if (summaries.length > 256) fail("STANDARD_OPERATION_BUDGET");
    }
  }
  return {
    operations: summaries,
    document_valid: true,
    full_openapi_support: false,
  };
}
function variants({ id, seed }) {
  const record = operations.get(id);
  if (!record) fail("STANDARD_UNKNOWN_OPERATION");
  const { op } = record;
  const parameters = op.allParameters.map((p) => ({
    name: p.name,
    in: p.in,
    value: sample(p.schema, exampleValues(p), seed),
  }));
  const bodies = Object.keys(op.requestBody?.content ?? {});
  const out = [];
  for (const media of bodies.length ? bodies : [null]) {
    const content = op.requestBody?.content[media];
    const value = media
      ? sample(content.schema, exampleValues(content), seed)
      : undefined;
    const positive = {
      operation_id: id,
      parameters,
      media,
      ...(media ? { body: value } : {}),
      negative: false,
      reason: "valid",
    };
    out.push(positive);
    // Every mutation is revalidated as genuinely invalid before it can be sent.
    if (media && content.schema) {
      const candidates = [null, "invalid", 123, [], {}, true];
      if (value && typeof value === "object" && !Array.isArray(value)) {
        for (const key of content.schema.required ?? []) {
          const v = { ...value };
          delete v[key];
          candidates.unshift(v);
        }
      }
      const representable = (v) =>
        /json/.test(media) ||
        (["application/x-www-form-urlencoded", "multipart/form-data"].includes(
          media,
        )
          ? v !== null && typeof v === "object" && !Array.isArray(v)
          : typeof v === "string");
      const bad = candidates.find(
        (v) => representable(v) && !validate(content.schema, v),
      );
      if (bad !== undefined)
        out.push({
          ...positive,
          body: bad,
          negative: true,
          reason: "body_schema",
        });
      for (const candidate of boundaryValues(content.schema, value)) {
        if (representable(candidate)) {
          const valid = validate(content.schema, candidate);
          out.push({
            ...positive,
            body: jsonValue(candidate),
            negative: !valid,
            reason: valid ? "valid_boundary" : "invalid_boundary",
          });
        }
      }
    }
    for (const p of op.allParameters.filter(
      (p) => p.required && p.in !== "path",
    )) {
      out.push({
        ...positive,
        parameters: parameters.filter(
          (v) => !(v.name === p.name && v.in === p.in),
        ),
        negative: true,
        reason: "missing_parameter",
      });
    }
    if (media && op.requestBody.required) {
      const missing = { ...positive, negative: true, reason: "missing_body" };
      delete missing.body;
      out.push(missing);
    }
  }
  if (op.requestBody && !op.requestBody.required)
    out.push({
      operation_id: id,
      parameters,
      media: null,
      negative: false,
      reason: "optional_body_omitted",
    });
  const seen = new Set(),
    unique = [];
  for (const c of out) {
    const key = JSON.stringify({
      parameters: c.parameters,
      media: c.media,
      body: c.body,
      has_body: Object.hasOwn(c, "body"),
    });
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(c);
    }
  }
  if (unique.length > 128) fail("STANDARD_VARIANT_BUDGET");
  return unique;
}
function headerValue(schema, value, explode) {
  if (!schema) return value;
  if (schema.type === "array")
    return value
      .split(",")
      .map((v) => headerValue(schema.items, v.trim(), false));
  if (schema.type === "object") {
    const tokens = value.split(","),
      out = {};
    if (explode) {
      for (const token of tokens) {
        const i = token.indexOf("=");
        if (i < 0) fail("STANDARD_HEADER_VALUE");
        const key = token.slice(0, i).trim();
        out[key] = headerValue(
          schema.properties?.[key] ?? schema.additionalProperties,
          token.slice(i + 1).trim(),
          false,
        );
      }
    } else {
      if (tokens.length % 2) fail("STANDARD_HEADER_VALUE");
      for (let i = 0; i < tokens.length; i += 2) {
        const key = tokens[i].trim();
        out[key] = headerValue(
          schema.properties?.[key] ?? schema.additionalProperties,
          tokens[i + 1].trim(),
          false,
        );
      }
    }
    return out;
  }
  if (
    ["integer", "number"].includes(schema.type) &&
    /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)
  )
    return Number(value);
  if (schema.type === "boolean" && ["true", "false"].includes(value))
    return value === "true";
  return value;
}
function requestContract({ id, test }) {
  const { op } = operations.get(id) ?? {};
  if (!op) fail("STANDARD_UNKNOWN_OPERATION");
  for (const p of op.allParameters) {
    const entry = test.parameters.find(
      (v) => v.name === p.name && v.in === p.in,
    );
    if (!entry && p.required) return { valid: false };
    if (entry && !validate(p.schema, entry.value)) return { valid: false };
  }
  if (!Object.hasOwn(test, "body")) return { valid: !op.requestBody?.required };
  const media = op.requestBody?.content[test.media];
  return { valid: Boolean(media) && validate(media?.schema, test.body) };
}
function responseContract({ id, status, headers, body, empty = false }) {
  const { op, method } = operations.get(id) ?? {};
  if (!op) fail("STANDARD_UNKNOWN_OPERATION");
  const response =
    op.responses[String(status)] ??
    op.responses[String(status)[0] + "XX"] ??
    op.responses.default;
  if (!response) return { valid: false, code: "undeclared_status" };
  for (const [name, header] of Object.entries(response.headers ?? {})) {
    if (name.toLowerCase() === "content-type") continue;
    const value = headers[name.toLowerCase()];
    if (value === undefined && header.required)
      return { valid: false, code: "response_header_missing" };
    if (value !== undefined) {
      try {
        const media = Object.keys(header.content ?? {})[0];
        const rule = header.schema ?? header.content?.[media]?.schema;
        const decoded = media?.includes("json")
          ? JSON.parse(value)
          : headerValue(rule, value, header.explode);
        if (!validate(rule, decoded, "read"))
          return { valid: false, code: "response_header_schema" };
      } catch {
        return { valid: false, code: "response_header_schema" };
      }
    }
  }
  if (method === "head" || [204, 304].includes(status))
    return { valid: empty, code: empty ? "" : "unexpected_body" };
  const content = response.content;
  if (!content || Object.keys(content).length === 0)
    return { valid: true, code: "" };
  const media = (headers["content-type"] ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const key =
    Object.keys(content).find((k) => k === media) ??
    Object.keys(content).find((k) => k === media.split("/")[0] + "/*") ??
    (content["*/*"] ? "*/*" : undefined);
  if (!key) return { valid: false, code: "response_media" };
  const valid = validate(content[key].schema, body, "read");
  return { valid, code: valid ? "" : "response_schema" };
}
parentPort.on("message", async ({ id, action, args }) => {
  try {
    const value =
      action === "compile"
        ? await compile(args)
        : action === "variants"
          ? variants(args)
          : action === "request"
            ? requestContract(args)
            : action === "response"
              ? responseContract(args)
              : fail("STANDARD_UNKNOWN_ACTION");
    parentPort.postMessage({ id, ok: true, value });
  } catch (error) {
    // Library exceptions can contain document fragments, filesystem paths,
    // examples, or credentials. Never propagate their messages/stacks.
    parentPort.postMessage({
      id,
      ok: false,
      code: /^STANDARD_[A-Z_]+$/.test(error.code ?? "")
        ? error.code
        : "STANDARD_VALIDATION_ERROR",
    });
  }
});

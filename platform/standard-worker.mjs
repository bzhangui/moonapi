// The untrusted standards compiler and regex/random generation live in a
// disposable, memory/time-bounded worker, never in the HTTP runner event loop.
import { parentPort } from "node:worker_threads";
import { createHash, randomUUID } from "node:crypto";
import SwaggerParser from "@apidevtools/swagger-parser";
import Enforcer from "openapi-enforcer";
import { parseDefinition } from "./definition.mjs";
import {
  parseExact,
  stringifyExact,
  cloneExact,
  numeric,
  number,
  decimal,
  shadow,
  setOwn,
} from "./standard-value.mjs";
import { validSchema, directed, effective } from "./standard-schema.mjs";
import {
  encodeRequest,
  deserializeParameter,
  serializeParameter,
} from "./standard-codec.mjs";
import {
  decodeMedia,
  encodeMedia,
  concreteMedia,
  castWire,
} from "./standard-media.mjs";
import { expression, pointer, runtimeValue } from "./standard-expression.mjs";
import {
  auditDocument,
  structuralShadow,
  stripRefSiblings,
  shieldLiterals,
} from "./standard-document.mjs";
import {
  STANDARD_CAPABILITIES,
  capabilitiesFor,
} from "./standard-capabilities.mjs";
import { contentKey } from "./standard-content.mjs";
import { loadCore } from "./runner.mjs";
import { encodeTransfer, decodeTransfer } from "./standard-transfer.mjs";
import { ModernStreamState } from "./modern-stream-state.mjs";
import {
  encodeSetCookieHeader,
  decodeSetCookieHeader,
  decodeModernHeader,
} from "./modern-media.mjs";
import {
  encodeModernMedia,
  decodeModernMedia,
  validateModernContent,
  encodeQuerystring,
  decodeQuerystring,
  normalizeModernMethod,
  sequenceMedia,
} from "./modern-media.mjs";

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
let ROOT_URI = "https://moonapi.invalid/openapi.json";
let referenceParser;
let grantedDocuments, externalDocuments, referenceOptions;
let grantedSources;
let modernPrepared, modernTools;
const streamState = new ModernStreamState();
const wireMethod = (record) =>
  modernPrepared ? record.method : record.method.toUpperCase();
const literalKey = "x-moonapi-literal-" + randomUUID();
let missingReference = false;
const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};
function parseSource(source, asData = false) {
  let value;
  try {
    value = parseDefinition(source);
  } catch {
    fail("STANDARD_DOCUMENT_ENCODING");
  }
  bounded(value);
  return asData ? value : shieldLiterals(stripRefSiblings(value), literalKey);
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
        stack.push([v[key], depth + 1]);
      }
    }
  }
}
function jsonValue(value) {
  if (value === undefined) return undefined;
  if (modernPrepared)
    return decodeTransfer(encodeTransfer(value, 262144), 262144);
  const out = stringifyExact(value);
  if (Buffer.byteLength(out) > 262144) fail("STANDARD_VALUE_BUDGET");
  return parseExact(out);
}
function validate(schema, value, mode = "write") {
  if (modernPrepared) return modernTools.validate(schema, value);
  if (!schema) return true;
  return validSchema(schema, value, mode);
}
const mediaOptions = (content = {}) =>
  modernPrepared
    ? {
        resolveSchema: (s, v) => modernTools.shape(s, v),
        validate: (s, v) => modernTools.validate(s, v),
        rootName: modernTools.rootName(content.schema),
      }
    : {};
const encodeContent = (media, value, content) =>
  modernPrepared
    ? encodeModernMedia(media, value, content, mediaOptions(content))
    : encodeMedia(media, value, content);
const decodeContent = (media, raw, content) =>
  modernPrepared
    ? decodeModernMedia(media, raw, content, mediaOptions(content))
    : decodeMedia(media, raw, content);
const contentValid = (content, value, mode = "write") =>
  modernPrepared
    ? validateModernContent(content, value, (s, v) => validate(s, v, mode))
    : validate(content?.schema, value, mode);
const parameterWire = (p) =>
  modernPrepared
    ? {
        ...p,
        modern: true,
        contentDefinition: p.content,
        content: Object.keys(p.content ?? {})[0],
        schema: modernTools.shape(p.schema),
      }
    : { ...p, content: Object.keys(p.content ?? {})[0] };
function sampleContent(content, media, seed, mode = "write") {
  if (!modernPrepared)
    return sample(content.schema, exampleValues(content), seed, mode);
  const values = exampleValues(content);
  for (const e of Object.values(content.examples ?? {})) {
    const text = e?.serializedValue ?? externalExample(e, content);
    if (text !== undefined)
      try {
        values.push(decodeContent(media, Buffer.from(text), content));
      } catch {}
  }
  if (content.schema === undefined && content.itemSchema !== undefined) {
    const value =
      content.itemSchema === false
        ? []
        : [sample(content.itemSchema, [], seed, mode)];
    if (contentValid(content, value, mode)) return value;
  }
  if (
    !/json|xml|^text\/|form|multipart/i.test(media) &&
    content.schema?.type === undefined
  )
    values.push(Buffer.from("synthetic-binary"));
  const value = sample(content.schema, values, seed, mode);
  if (!contentValid(content, value, mode))
    fail("STANDARD_GENERATION_UNSAT_OR_BUDGET");
  return value;
}
function sample(schema, examples, seed, mode = "write") {
  if (modernPrepared) return modernTools.sample(schema, examples, seed);
  if (!schema) return examples[0] ?? "sample";
  for (const candidate of examples) {
    if (candidate !== undefined) {
      const projected = projectRequest(schema, jsonValue(candidate), 0, mode);
      if (validate(schema, projected, mode)) return projected;
    }
  }
  const generated = directed(schema, seed, 0, new Set(), mode);
  if (generated !== undefined) return generated;
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
    const [generator, generationError] = Enforcer.v3_0.Schema(shadow(schema));
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
          readWriteMode: mode,
        });
        if (!serialError) {
          const projected = projectRequest(
            schema,
            jsonValue(serialized),
            0,
            mode,
          );
          if (validate(schema, projected, mode)) return projected;
        }
      }
    }
    for (const candidate of candidates)
      if (validate(schema, candidate, mode)) return candidate;
  } finally {
    Math.random = random;
  }
  fail("STANDARD_GENERATION_UNSAT_OR_BUDGET");
}
function projectRequest(schema, value, depth = 0, mode = "write") {
  if (!schema || depth > 16 || value === null || typeof value !== "object")
    return value;
  for (const rule of [
    ...(schema.allOf ?? []),
    ...(schema.oneOf ?? []),
    ...(schema.anyOf ?? []),
  ])
    value = projectRequest(rule, value, depth + 1, mode);
  if (Array.isArray(value))
    return value.map((v) => projectRequest(schema.items, v, depth + 1, mode));
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    if (mode === "write" ? prop.readOnly : prop.writeOnly) delete value[key];
    else if (Object.hasOwn(value, key))
      setOwn(value, key, projectRequest(prop, value[key], depth + 1, mode));
  }
  return value;
}
function exampleValues(node) {
  return [
    node?.example,
    ...Object.values(node?.examples ?? {}).map((e) => {
      if (e && Object.hasOwn(e, "value")) return e.value;
      if (modernPrepared && e && Object.hasOwn(e, "dataValue"))
        return e.dataValue;
      if (modernPrepared) return undefined; // serialized forms decode via their media/location
      const raw = e?.externalValue
        ? grantedSources?.get(new URL(e.externalValue, ROOT_URI).href)
        : undefined;
      return raw === undefined ? undefined : parseSource(raw, true);
    }),
    node?.schema?.example,
    node?.schema?.default,
    ...(modernPrepared && Array.isArray(node?.schema?.examples)
      ? node.schema.examples
      : []),
  ];
}
function externalExample(example, node) {
  if (!example?.externalValue) return undefined;
  if (modernPrepared) {
    const base =
      modernPrepared.locations.get(example)?.base ??
      modernPrepared.locations.get(node)?.base ??
      ROOT_URI;
    return modernPrepared.resourceText(example.externalValue, base);
  }
  return grantedSources?.get(new URL(example.externalValue, ROOT_URI).href);
}
function parameterExamples(parameter) {
  const out = exampleValues(parameter);
  if (!modernPrepared) return out;
  for (const e of Object.values(parameter.examples ?? {})) {
    const serialized = e?.serializedValue ?? externalExample(e, parameter);
    if (serialized === undefined) continue;
    try {
      const wire = { path: {}, query: "", headers: {} };
      if (parameter.in === "header")
        wire.headers[parameter.name.toLowerCase()] = serialized;
      else if (parameter.in === "cookie") wire.headers.cookie = serialized;
      else if (parameter.in === "path") wire.path[parameter.name] = serialized;
      else wire.query = serialized;
      out.push(
        deserializeParameter(parameterWire(parameter), wire, mediaOptions()),
      );
    } catch {}
  }
  return out;
}
// Constraint-directed candidates complement library sampling. Each candidate is
// independently validated before its valid/invalid label is assigned.
function boundaryValues(schema, value, depth = 0) {
  if (!schema || depth > 3) return [];
  const out = [...(schema.enum ?? [])];
  if (numeric(value)) {
    const step = schema.multipleOf ?? (schema.type === "integer" ? 1 : 0.5);
    const add = (a, b, sign = 1n) => {
      const [x, e] = decimal(a),
        [y, f] = decimal(b),
        z = Math.min(e, f);
      return number(
        String(x * 10n ** BigInt(e - z) + sign * y * 10n ** BigInt(f - z)) +
          "e" +
          z,
      );
    };
    out.push(0, add(value, step, -1n), add(value, step));
    if (schema.minimum !== undefined)
      out.push(
        schema.minimum,
        add(schema.minimum, step, -1n),
        add(schema.minimum, step),
      );
    if (schema.maximum !== undefined)
      out.push(
        schema.maximum,
        add(schema.maximum, step, -1n),
        add(schema.maximum, step),
      );
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
      for (const [k, v] of Object.entries(branch.properties || {}))
        setOwn(properties, k, v);
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
function metadata(id, op, item, context = definition) {
  const body = op.requestBody;
  const security = op.security ?? context.security ?? [];
  const blockers = [];
  // Capability is tested independently of a particular run's permissions.
  const media = Object.keys(body?.content ?? {});
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
      ...(modernPrepared ? { modern: true, contentDefinition: p.content } : {}),
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
      op.servers ?? item.servers ?? context.servers ?? [{ url: "/" }],
    ),
    security: jsonValue(security),
    security_schemes: jsonValue(
      modernPrepared
        ? (modernPrepared.operationCatalog.find((r) => r.id === id)
            ?.securitySchemes ?? modernPrepared.contextSchemes(context))
        : (context.components?.securitySchemes ?? {}),
    ),
    ...(modernPrepared
      ? { openapi_version: modernPrepared.version, modern: true }
      : {}),
    blockers: [...new Set(blockers)],
    callbacks: Object.keys(op.callbacks ?? {}),
  };
}
async function compile({
  source,
  documents = {},
  documentURI = "https://moonapi.invalid/openapi.json",
}) {
  await loadCore();
  const root = new URL(documentURI);
  if (root.hash || root.username || root.password)
    fail("STANDARD_DOCUMENT_URI");
  ROOT_URI = root.href;
  const native = parseSource(source, true);
  if (/^3\.[12]\.\d+$/.test(native.openapi ?? "")) {
    // Do not charge legacy 3.0 workers for loading the native modern compiler.
    // Keep loading inside the same bounded worker, not on the HTTP event loop.
    const [{ prepareModernDocument }, { modernSchemaTools }] =
      await Promise.all([
        import("./modern-document.mjs"),
        import("./modern-generation.mjs"),
      ]);
    modernPrepared = await prepareModernDocument(source, {
      documents,
      documentURI: ROOT_URI,
    });
    api = definition = modernPrepared.definition;
    ROOT_URI = modernPrepared.documentURI;
    modernTools = modernSchemaTools(modernPrepared);
    grantedSources = new Map(Object.entries(documents));
    for (const root of modernPrepared.schemaRoots)
      modernTools.compile(root.schema);
    operations = new Map();
    const summaries = [];
    for (const r of modernPrepared.operations) {
      if (r.zone !== "paths") continue;
      const op = { ...r.op },
        merged = new Map();
      // TRACE has no request content semantics; HTTP prohibits generating it.
      // Retain the source document, but do not generate or claim to send a body.
      if (r.method === "TRACE") delete op.requestBody;
      for (const p of [...(r.item.parameters ?? []), ...(op.parameters ?? [])])
        merged.set(
          p.in + ":" + (p.in === "header" ? p.name.toLowerCase() : p.name),
          { ...p },
        );
      op.allParameters = [...merged.values()].filter(
        (p) =>
          !(
            p.in === "header" &&
            ["accept", "content-type", "authorization"].includes(
              p.name.toLowerCase(),
            )
          ),
      );
      for (const p of op.allParameters)
        if (p.schema === undefined && p.content)
          p.schema = Object.values(p.content)[0]?.schema;
      operations.set(r.id, {
        ...r,
        op,
        definition: r.context,
        sourceURI: r.baseURI ?? modernPrepared.documentURI,
      });
      summaries.push({
        ...metadata(r.id, op, r.item, r.context),
        method: r.method,
        path: r.route,
      });
    }
    return {
      operations: summaries,
      webhooks:
        modernPrepared.webhookOperations?.map((r) => ({
          id: r.id,
          name: r.route,
          method: r.method,
        })) ?? [],
      document_valid: true,
      ...capabilitiesFor(modernPrepared.version),
    };
  }
  modernPrepared = modernTools = undefined;
  const doc = parseSource(source);
  bounded(doc);
  if (!/^3\.0\.\d+$/.test(doc.openapi ?? ""))
    fail("STANDARD_OPENAPI_3_0_REQUIRED");
  if (Object.keys(documents).length > 16) fail("STANDARD_REFERENCE_BUDGET");
  let bytes = Buffer.byteLength(source);
  const refs = new Map();
  grantedSources = new Map();
  for (const [uri, content] of Object.entries(documents)) {
    const u = new URL(uri);
    if (u.username || u.password || u.hash) fail("STANDARD_REFERENCE_URI");
    bytes += Buffer.byteLength(content);
    if (bytes > 4194304) fail("STANDARD_REFERENCE_BUDGET");
    const parsed = parseSource(content);
    refs.set(u.href, parsed);
    grantedSources.set(u.href, content);
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
        if (!refs.has(url.href)) {
          missingReference = true;
          fail("STANDARD_REFERENCE_NOT_GRANTED");
        }
        return stringifyExact(refs.get(url.href));
      },
    },
  };
  const bundle = await parser.bundle(ROOT_URI, doc, {
    resolve: resolver,
    parse: {
      exact: {
        order: 1,
        canParse: () => true,
        parse: (file) => parseSource(String(file.data)),
      },
      json: false,
      yaml: false,
    },
  });
  referenceParser = parser;
  grantedDocuments = refs;
  externalDocuments = new Map();
  referenceOptions = {
    resolve: resolver,
    parse: {
      exact: {
        order: 1,
        canParse: () => true,
        parse: (file) => parseSource(String(file.data)),
      },
      json: false,
      yaml: false,
    },
  };
  await SwaggerParser.validate(structuralShadow(bundle), {
    resolve: { external: false, file: false, http: false },
  });
  api = await SwaggerParser.dereference(bundle, {
    resolve: { external: false, file: false, http: false },
  });
  shieldLiterals(api, literalKey, true);
  auditDocument(api);
  definition = api;
  operations = new Map();
  const summaries = [];
  for (const route of Object.keys(api.paths).sort()) {
    if (!route.startsWith("/")) continue;
    const item = api.paths[route];
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;
      if (["get", "head", "trace"].includes(method)) delete op.requestBody;
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
    openapi_version: doc.openapi,
    ...STANDARD_CAPABILITIES,
  };
}
function variants({ id, seed }) {
  const record = operations.get(id);
  if (!record) fail("STANDARD_UNKNOWN_OPERATION");
  const { op } = record;
  const parameters = op.allParameters.flatMap((p) => {
    try {
      return [
        {
          name: p.name,
          in: p.in,
          value: sample(p.schema, parameterExamples(p), seed),
        },
      ];
    } catch (error) {
      if (p.required) throw error;
      return [];
    }
  });
  const bodies = Object.keys(op.requestBody?.content ?? {});
  const out = [];
  for (const media of bodies.length ? bodies : [null]) {
    const content = op.requestBody?.content[media];
    let value;
    try {
      value = media ? sampleContent(content, media, seed) : undefined;
    } catch (error) {
      if (op.requestBody.required) throw error;
      continue;
    }
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
    if (
      media &&
      (content.schema !== undefined || content.itemSchema !== undefined)
    ) {
      const candidates = [null, "invalid", 123, [], {}, true];
      if (value && typeof value === "object" && !Array.isArray(value)) {
        for (const key of content.schema?.required ?? []) {
          const v = { ...value };
          delete v[key];
          candidates.unshift(v);
        }
      }
      const representable = (v) =>
        modernPrepared
          ? (() => {
              try {
                encodeModernMedia(media, v, content, {
                  ...mediaOptions(content),
                  validate: undefined,
                });
                return true;
              } catch {
                return false;
              }
            })()
          : /json/.test(media) ||
            ([
              "application/x-www-form-urlencoded",
              "multipart/form-data",
            ].includes(media)
              ? v !== null && typeof v === "object" && !Array.isArray(v)
              : typeof v === "string");
      if (content.itemSchema !== undefined)
        candidates.push([null], ["invalid"], [123], [{}], [true]);
      const bad = candidates.find(
        (v) => representable(v) && !contentValid(content, v),
      );
      if (bad !== undefined)
        out.push({
          ...positive,
          body: bad,
          negative: true,
          reason: "body_schema",
        });
      for (const candidate of boundaryValues(content.schema ?? {}, value)) {
        if (representable(candidate)) {
          const valid = contentValid(content, candidate);
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
    for (const p of op.allParameters) {
      const original = parameters.find(
        (x) => x.in === p.in && x.name === p.name,
      );
      if (!original) continue;
      for (const candidate of boundaryValues(p.schema, original.value).slice(
        0,
        16,
      )) {
        out.push({
          ...positive,
          parameters: parameters.map((x) =>
            x === original ? { ...x, value: candidate } : x,
          ),
          negative: !validate(p.schema, candidate),
          reason: "parameter_boundary",
        });
      }
      if (!p.required)
        out.push({
          ...positive,
          parameters: parameters.filter((x) => x !== original),
          reason: "optional_parameter_omitted",
        });
    }
    for (const branch of content?.schema?.oneOf ||
      content?.schema?.anyOf ||
      []) {
      try {
        const v = sample(branch, [branch.example, branch.default], seed);
        if (validate(content.schema, v))
          out.push({ ...positive, body: v, reason: "composition_branch" });
      } catch {}
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
    const key = stringifyExact({
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
        setOwn(
          out,
          key,
          headerValue(
            schema.properties?.[key] ?? schema.additionalProperties,
            token.slice(i + 1).trim(),
            false,
          ),
        );
      }
    } else {
      if (tokens.length % 2) fail("STANDARD_HEADER_VALUE");
      for (let i = 0; i < tokens.length; i += 2) {
        const key = tokens[i].trim();
        setOwn(
          out,
          key,
          headerValue(
            schema.properties?.[key] ?? schema.additionalProperties,
            tokens[i + 1].trim(),
            false,
          ),
        );
      }
    }
    return out;
  }
  if (
    ["integer", "number"].includes(schema.type) &&
    /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)
  )
    return number(value);
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
    if (
      entry &&
      !(modernPrepared && p.content
        ? contentValid(Object.values(p.content)[0], entry.value)
        : validate(p.schema, entry.value))
    )
      return { valid: false };
  }
  if (!Object.hasOwn(test, "body")) return { valid: !op.requestBody?.required };
  const media = op.requestBody?.content[test.media];
  return { valid: Boolean(media) && contentValid(media, test.body) };
}
function responseContract({ id, status, headers, body, empty = false }) {
  const { op, method } = operations.get(id) ?? {};
  if (!op) fail("STANDARD_UNKNOWN_OPERATION");
  const response = responseFor(op, status);
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
        const decoded = modernPrepared
          ? name.toLowerCase() === "set-cookie"
            ? decodeSetCookieHeader(header, value, mediaOptions())
            : decodeModernHeader(header, value, mediaOptions())
          : media
            ? decodeContent(media, Buffer.from(value), header.content[media])
            : headerValue(
                modernPrepared ? modernTools.shape(rule) : rule,
                value,
                header.explode,
              );
        if (!validate(rule, decoded, "read"))
          return { valid: false, code: "response_header_schema" };
      } catch (error) {
        if (/BUDGET/.test(error.message)) throw error;
        return { valid: false, code: "response_header_schema" };
      }
    }
  }
  if (wireMethod(operations.get(id)) === "HEAD" || [204, 304].includes(status))
    return { valid: empty, code: empty ? "" : "unexpected_body" };
  const content = response.content;
  if (!content || Object.keys(content).length === 0)
    return {
      valid: true,
      code: "",
      ...(modernPrepared && op.responses === undefined
        ? { unconstrained: true }
        : {}),
    };
  const media = (headers["content-type"] ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const key = contentKey(content, headers["content-type"]);
  if (!key) return { valid: false, code: "response_media" };
  const valid = contentValid(content[key], body, "read");
  return { valid, code: valid ? "" : "response_schema" };
}
function profiles() {
  const summary = (schema) => {
    const s = modernPrepared ? modernTools.shape(schema) : effective(schema);
    return {
      type: s.type,
      format: s.format,
      fields: Object.keys(s.properties || {}),
      required: s.required || [],
    };
  };
  return [...operations].map(([id, { op, route, method }]) => ({
    id,
    path: route,
    method: wireMethod({ method }),
    parameters: op.allParameters.map((p) => ({
      name: p.name,
      in: p.in,
      required: !!p.required,
      ...summary(p.schema),
    })),
    requests: Object.entries(op.requestBody?.content || {}).map(
      ([media, c]) => ({ media, ...summary(c.schema) }),
    ),
    responses: Object.entries(op.responses ?? {}).map(([status, r]) => ({
      status,
      location: !!Object.keys(r.headers || {}).find(
        (h) => h.toLowerCase() === "location",
      ),
      links: Object.keys(r.links || {}),
      content: Object.entries(r.content || {}).map(([media, c]) => ({
        media,
        ...summary(c.schema),
      })),
    })),
  }));
}
function wireRequest({ id, test }) {
  const record = operations.get(id);
  if (!record) fail("STANDARD_UNKNOWN_OPERATION");
  const operation = {
    ...metadata(
      id,
      record.op,
      record.item || {},
      record.definition || definition,
    ),
    path: record.route,
    body_content: record.op.requestBody?.content,
  };
  operation.parameters = operation.parameters.map((p) => ({
    ...p,
    schema: (modernPrepared ? modernTools.shape : (x) => x)(
      record.op.allParameters.find((x) => x.in === p.in && x.name === p.name)
        ?.schema,
    ),
  }));
  function preparedEncoding(
    e,
    values,
    depth = 0,
    nested = /^multipart\//i.test(e.contentType ?? ""),
    parentMedia = "",
  ) {
    if (depth > 8) fail("MODERN_MIME_DEPTH_BUDGET");
    const copy = { ...e, headers: { ...e.headers } };
    for (const [name, source] of Object.entries(e.headers || {})) {
      if (name.toLowerCase() === "content-type") continue;
      const h = { ...source };
      copy.headers[name] = h;
      const mt = Object.keys(h.content || {})[0],
        rule = h.schema ?? h.content?.[mt]?.schema;
      let value;
      try {
        value = sample(rule, exampleValues(h), 42, "write");
        h.example = value;
        h.__wireValue = serializeParameter(
          {
            ...h,
            name,
            in: "header",
            schema: modernPrepared ? modernTools.shape(rule, value) : rule,
            content: mt,
            contentDefinition: h.content,
            modern: !!modernPrepared,
          },
          value,
          mediaOptions(),
        )[1];
      } catch (error) {
        if (h.required) throw error;
        delete copy.headers[name];
        continue;
      }
    }
    if (
      parentMedia === "multipart/form-data" &&
      ["style", "explode", "allowReserved"].some((k) => Object.hasOwn(e, k))
    )
      nested = false;
    if (!nested) return copy;
    const ownMedia = String(depth === 0 ? test.media : (e.contentType ?? ""))
      .split(/[;,]/)[0]
      .trim()
      .toLowerCase();
    if (e.encoding)
      copy.encoding = Object.fromEntries(
        Object.entries(e.encoding).map(([k, v]) => {
          const active = values
            .filter(
              (x) => x !== null && typeof x === "object" && Object.hasOwn(x, k),
            )
            .flatMap((x) => (Array.isArray(x[k]) ? x[k] : [x[k]]));
          return [
            k,
            active.length
              ? preparedEncoding(v, active, depth + 1, undefined, ownMedia)
              : v,
          ];
        }),
      );
    if (e.prefixEncoding)
      copy.prefixEncoding = e.prefixEncoding.map((v, i) => {
        const active = values
          .filter((x) => Array.isArray(x) && i < x.length)
          .map((x) => x[i]);
        return active.length
          ? preparedEncoding(v, active, depth + 1, undefined, ownMedia)
          : v;
      });
    if (e.itemEncoding) {
      const active = values
        .filter(Array.isArray)
        .flatMap((x) => x.slice(e.prefixEncoding?.length ?? 0));
      if (active.length)
        copy.itemEncoding = preparedEncoding(
          e.itemEncoding,
          active,
          depth + 1,
          undefined,
          ownMedia,
        );
    }
    return copy;
  }
  if (operation.body_content)
    operation.body_content = Object.fromEntries(
      Object.entries(operation.body_content).map(([key, c]) => [
        key,
        key === test.media && /^multipart\//i.test(key)
          ? preparedEncoding(c, [test.body], 0, true)
          : c,
      ]),
    );
  // Intentional negative instances must remain serializable. Only their
  // outbound schema assertion is bypassed; wire safety/budgets, independent
  // validateRequest classification and all response decoding stay strict.
  const result = encodeRequest(operation, test, {
    ...mediaOptions(),
    ...(test.negative ? { validate: undefined } : {}),
  });
  return { ...result, body: result.body?.toString("base64") };
}
function wireRequestContract({ id, route, headers, raw, decodedBody }) {
  const record = operations.get(id);
  if (!record) fail("STANDARD_UNKNOWN_OPERATION");
  const url = new URL(route, "http://127.0.0.1"),
    names = [];
  const pattern = record.route
    .split(/(\{[^{}]+\})/)
    .map((v) => {
      if (v.startsWith("{")) {
        names.push(v.slice(1, -1));
        return "([^/]+)";
      }
      return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  const match = new RegExp("^" + pattern + "$").exec(url.pathname),
    path = {};
  if (!match) return { valid: false };
  names.forEach((n, i) => setOwn(path, n, match[i + 1]));
  const test = { operation_id: id, parameters: [] };
  for (const p of record.op.allParameters) {
    let value;
    try {
      value = deserializeParameter(
        parameterWire(p),
        { path, query: url.search, headers },
        mediaOptions(),
      );
    } catch {
      return { valid: false };
    }
    if (value !== undefined)
      test.parameters.push({ in: p.in, name: p.name, value });
  }
  if (raw !== undefined && record.op.requestBody) {
    const media = (headers["content-type"] || "")
        .split(";")[0]
        .trim()
        .toLowerCase(),
      content = record.op.requestBody.content;
    const key = contentKey(content, headers["content-type"]);
    if (!key) return { valid: false };
    try {
      test.media = key;
      test.body =
        decodedBody !== undefined
          ? decodedBody
          : decodeContent(
              headers["content-type"],
              Buffer.from(raw, "base64"),
              content[key],
            );
    } catch {
      return { valid: false };
    }
  }
  return requestContract({ id, test });
}
function wireResponse({ id, status, headers, raw }) {
  const { op } = operations.get(id) ?? {};
  if (!op) fail("STANDARD_UNKNOWN_OPERATION");
  const response = responseFor(op, status);
  const media = (headers["content-type"] || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const key = contentKey(response?.content, headers["content-type"]);
  let body = "",
    contract;
  const bytes = Buffer.from(raw, "base64");
  try {
    if (key && bytes.length)
      body = decodeContent(
        headers["content-type"],
        bytes,
        response.content[key],
      );
    else if (
      key &&
      /json/.test(media) &&
      wireMethod(operations.get(id)) !== "HEAD" &&
      ![204, 304].includes(status)
    )
      throw new Error();
  } catch (error) {
    if (/BUDGET/.test(error.message)) throw error;
    return {
      body: null,
      contract: {
        valid: false,
        code: /json/.test(media)
          ? "invalid_json_or_precision"
          : "invalid_media",
      },
    };
  }
  contract = responseContract({
    id,
    status,
    headers,
    body,
    empty: bytes.length === 0,
  });
  return { body, contract };
}
function streamOpen({ id, stream_id, status, headers }) {
  if (!modernPrepared || !sequenceMedia(headers["content-type"]))
    return { opened: false };
  const record = operations.get(id),
    response = responseFor(record.op, status),
    media = (headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  const content = response?.content ?? {},
    key = contentKey(content, headers["content-type"]);
  if (!key || wireMethod(record) === "HEAD" || [204, 304].includes(status))
    return { opened: false };
  return streamState.open({
    id: stream_id,
    media: headers["content-type"],
    content: content[key],
    options: { ...mediaOptions(content[key]), timeout: 30000 },
  });
}
function responseFor(op, status) {
  if (modernPrepared && op.responses === undefined) return {};
  return (
    op.responses?.[status] ??
    op.responses?.[String(status)[0] + "XX"] ??
    op.responses?.default
  );
}
async function targetOperation(link, base = ROOT_URI) {
  if (modernPrepared) {
    const r = Object.hasOwn(link, "operationId")
      ? modernPrepared.resolveOperationId(link.operationId)
      : modernPrepared.resolveOperationRef(link.operationRef, base);
    if (!r || r.zone !== "paths") return undefined;
    if (operations.has(r.id)) return r.id;
    const op = {
      ...r.op,
      allParameters: r.allParameters.map((p) => ({
        ...p,
        schema: p.schema ?? Object.values(p.content ?? {})[0]?.schema,
      })),
    };
    operations.set(r.id, {
      ...r,
      op,
      definition: r.context,
      sourceURI: r.baseURI,
    });
    return r.id;
  }
  if (link.operationId)
    return operations.has(link.operationId) ? link.operationId : undefined;
  const url = new URL(link.operationRef, base);
  let operation;
  try {
    operation = referenceParser.$refs.get(url.href);
  } catch {
    if (url.href.split("#")[0] === ROOT_URI)
      operation = pointer(api, decodeURIComponent(url.hash.slice(1)));
  }
  for (const [id, r] of operations)
    if (
      r.op === operation ||
      (operation?.operationId === r.op.operationId && operation.operationId)
    )
      return id;
  const uri = url.href.split("#")[0];
  if (uri !== ROOT_URI && grantedDocuments.has(uri)) {
    let ext = externalDocuments.get(uri);
    if (!ext) {
      const p = new SwaggerParser(),
        input = cloneExact(grantedDocuments.get(uri));
      const b = await p.bundle(uri, input, referenceOptions);
      await SwaggerParser.validate(structuralShadow(b), {
        resolve: { external: false, file: false, http: false },
      });
      ext = await SwaggerParser.dereference(b, {
        resolve: { external: false, file: false, http: false },
      });
      shieldLiterals(ext, literalKey, true);
      auditDocument(ext);
      externalDocuments.set(uri, ext);
    }
    const target = pointer(ext, decodeURIComponent(url.hash.slice(1)));
    for (const [route, item] of Object.entries(ext.paths))
      if (route.startsWith("/"))
        for (const method of METHODS)
          if (item[method] === target) {
            const id =
              "external-" +
              createHash("sha256").update(url.href).digest("hex").slice(0, 24);
            const op = target,
              merged = new Map();
            for (const param of [
              ...(item.parameters || []),
              ...(op.parameters || []),
            ]) {
              if (!param.schema && param.content)
                param.schema =
                  param.content[Object.keys(param.content)[0]]?.schema;
              merged.set(
                param.in +
                  ":" +
                  (param.in === "header"
                    ? param.name.toLowerCase()
                    : param.name),
                param,
              );
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
            operations.set(id, {
              op,
              route,
              method,
              item,
              definition: ext,
              sourceURI: uri,
            });
            return id;
          }
  }
  return undefined;
}
async function linked({ id, context, seed }) {
  const record = operations.get(id);
  if (!record) fail("STANDARD_UNKNOWN_OPERATION");
  const out = [];
  for (const [name, link] of Object.entries(
    responseFor(record.op, context.status)?.links || {},
  )) {
    const target = await targetOperation(link, record.sourceURI || ROOT_URI);
    if (!target) {
      out.push({ name, code: "link_target_not_in_document" });
      continue;
    }
    const r = operations.get(target),
      test = variants({ id: target, seed }).find((t) => !t.negative);
    if (!test) {
      out.push({ name, code: "link_no_candidate" });
      continue;
    }
    for (const [key, expr] of Object.entries(link.parameters || {})) {
      const p =
        r.op.allParameters.find((p) => key === p.in + "." + p.name) ||
        r.op.allParameters.find((p) => key === p.name);
      if (!p) fail("STANDARD_LINK_PARAMETER");
      const value = runtimeValue(expr, context),
        index = test.parameters.findIndex(
          (x) => x.in === p.in && x.name === p.name,
        );
      if (index >= 0) test.parameters.splice(index, 1);
      if (value !== undefined)
        test.parameters.push({ in: p.in, name: p.name, value });
    }
    if (Object.hasOwn(link, "requestBody")) {
      const v = runtimeValue(link.requestBody, context);
      if (v === undefined) delete test.body;
      else test.body = v;
    }
    out.push({
      name,
      test,
      operation: {
        ...metadata(target, r.op, r.item || {}, r.definition || definition),
        method: wireMethod(r),
        path: r.route,
      },
      server: link.server,
      valid: requestContract({ id: target, test }).valid,
    });
  }
  return out;
}
function itemMethods(item) {
  return [...METHODS, ...(modernPrepared ? ["query"] : [])]
    .filter((m) => item?.[m])
    .map((m) => ({ method: m.toUpperCase(), op: item[m] }))
    .concat(
      modernPrepared
        ? Object.entries(item?.additionalOperations ?? {}).map(
            ([method, op]) => ({ method, op }),
          )
        : [],
    );
}
function callbacks({ id }) {
  const { op } = operations.get(id) ?? {};
  if (!op) fail("STANDARD_UNKNOWN_OPERATION");
  const out = [];
  for (const [name, callback] of Object.entries(op.callbacks || {}))
    for (const [expr, item] of Object.entries(callback))
      if (!expr.startsWith("x-"))
        out.push({
          name,
          expression: expr,
          methods: itemMethods(item).map((r) => r.method),
        });
  return out;
}
function callbackContract({
  id,
  name,
  expression: expr,
  incoming,
  seed,
  credentials = {},
}) {
  const record = operations.get(id),
    { op } = record ?? {},
    item = op?.callbacks?.[name]?.[expr],
    operation = itemMethods(item).find((r) => r.method === incoming.method)?.op;
  if (!operation) return { valid: false, code: "callback_method", status: 405 };
  return inboundContract({
    operation,
    item,
    incoming,
    seed,
    credentials,
    context: record.definition ?? definition,
  });
}
function webhookContract({ name, incoming, seed, credentials = {} }) {
  const record = modernPrepared?.webhookOperations.find(
    (r) => r.route === name && r.method === incoming.method,
  );
  if (!record) return { valid: false, code: "webhook_method", status: 405 };
  return inboundContract({
    operation: record.op,
    item: record.item,
    incoming,
    seed,
    credentials,
    context: record.context,
  });
}
function inboundContract({
  operation,
  item,
  incoming,
  seed,
  credentials,
  context,
}) {
  const headers = Object.fromEntries(
      Object.entries(incoming.headers).map(([k, v]) => [
        k.toLowerCase(),
        String(v),
      ]),
    ),
    url = new URL(incoming.url, "http://127.0.0.1");
  const security = operation.security ?? context.security ?? [];
  const schemes = modernPrepared
    ? (modernPrepared.operationCatalog.find(
        (r) => r.op === operation && r.context === context,
      )?.securitySchemes ?? modernPrepared.contextSchemes(context))
    : (context.components?.securitySchemes ?? {});
  if (
    security.length &&
    !security.some((r) =>
      Object.entries(r).every(([name, scopes]) => {
        const s = schemes[name],
          c = Object.hasOwn(credentials, name) ? credentials[name] : undefined;
        if (
          !s ||
          !c ||
          !scopes.every((x) =>
            (["oauth2", "openIdConnect"].includes(s.type)
              ? c.scopes
              : c.roles
            )?.includes(x),
          )
        )
          return false;
        if (s.type === "mutualTLS")
          return (
            incoming.peer_authorized === true &&
            (!c.acceptedFingerprints ||
              c.acceptedFingerprints.includes(incoming.peer_fingerprint))
          );
        if (s.type === "apiKey") {
          const value =
            s.in === "query"
              ? url.searchParams.get(s.name)
              : s.in === "header"
                ? headers[s.name.toLowerCase()]
                : headers.cookie
                    ?.split(/;\s*/)
                    .find((x) => x.startsWith(encodeURIComponent(s.name) + "="))
                    ?.slice(encodeURIComponent(s.name).length + 1);
          return (
            value === c.value ||
            (s.in === "cookie" && value === encodeURIComponent(c.value))
          );
        }
        const expected =
          s.type === "http" && s.scheme.toLowerCase() === "basic"
            ? "Basic " +
              Buffer.from(c.username + ":" + c.password).toString("base64")
            : (s.type === "http" && s.scheme.toLowerCase() !== "bearer"
                ? s.scheme
                : "Bearer") +
              " " +
              c.value;
        return headers.authorization === expected;
      }),
    )
  )
    return { valid: false, status: 401, code: "callback_authentication" };
  const params = new Map();
  for (const p of [...(item.parameters || []), ...(operation.parameters || [])])
    params.set(p.in + ":" + p.name, p);
  for (const p of params.values()) {
    const mt = Object.keys(p.content || {})[0],
      rule = p.schema ?? p.content?.[mt]?.schema;
    let v;
    try {
      v = deserializeParameter(
        modernPrepared
          ? parameterWire({ ...p, schema: rule })
          : { ...p, schema: rule, content: mt },
        { query: url.search, headers, path: incoming.path || {} },
        mediaOptions(),
      );
    } catch (error) {
      if (/BUDGET/.test(error.message)) throw error;
      return { valid: false, code: "callback_parameter", status: 400 };
    }
    if (v === undefined) {
      if (p.required)
        return { valid: false, code: "callback_parameter", status: 400 };
      continue;
    }
    if (!validate(rule, v))
      return { valid: false, code: "callback_parameter", status: 400 };
  }
  const bytes = Buffer.from(incoming.raw, "base64"),
    mt = (headers["content-type"] || "").split(";")[0],
    body = operation.requestBody,
    hasBody = bytes.length > 0 || Object.hasOwn(headers, "content-type");
  if (body?.required && !hasBody)
    return { valid: false, code: "callback_body_required", status: 400 };
  if (hasBody && body) {
    const key = contentKey(body.content, headers["content-type"]);
    if (!key) return { valid: false, code: "callback_media", status: 400 };
    try {
      const value = decodeContent(
        headers["content-type"],
        bytes,
        body.content[key],
      );
      if (!contentValid(body.content[key], value))
        return { valid: false, code: "callback_body_schema", status: 400 };
    } catch (error) {
      if (/BUDGET/.test(error.message)) throw error;
      return { valid: false, code: "callback_body_encoding", status: 400 };
    }
  }
  const key =
      Object.keys(operation.responses ?? {}).find((k) => /^2\d\d$/.test(k)) ||
      (operation.responses?.["2XX"] ? "2XX" : undefined) ||
      Object.keys(operation.responses ?? {}).find((k) =>
        /^[1-5]\d\d$/.test(k),
      ) ||
      "default",
    response =
      modernPrepared && operation.responses === undefined
        ? {}
        : operation.responses[key];
  if (!response) fail("STANDARD_CALLBACK_RESPONSE");
  const status =
      key === "default"
        ? modernPrepared && operation.responses === undefined
          ? 204
          : 200
        : key.endsWith("XX")
          ? Number(key[0]) * 100
          : Number(key),
    outHeaders = {};
  let encoded;
  for (const [k, h] of Object.entries(response.headers || {}))
    if (k.toLowerCase() !== "content-type") {
      const mt = Object.keys(h.content || {})[0],
        rule = h.schema ?? h.content?.[mt]?.schema,
        value = sample(rule, exampleValues(h), seed, "read");
      outHeaders[k] =
        modernPrepared && k.toLowerCase() === "set-cookie"
          ? encodeSetCookieHeader(h, value, mediaOptions())
          : serializeParameter(
              { ...h, name: k, in: "header", schema: rule, content: mt },
              value,
            )[1];
    }
  const media = Object.keys(response.content || {})[0];
  if (media && ![204, 304].includes(status) && incoming.method !== "HEAD") {
    const c = response.content[media],
      v = sampleContent(c, media, seed, "read");
    if (!contentValid(c, v, "read"))
      fail("STANDARD_CALLBACK_RESPONSE_GENERATION");
    encoded = encodeContent(media, v, c);
    outHeaders["content-type"] = encoded.contentType;
  }
  return {
    valid: true,
    status,
    headers: outHeaders,
    body: encoded?.body.toString("base64"),
  };
}
parentPort.on("message", async (message) => {
  const { id, action, args } = decodeTransfer(message);
  try {
    const value =
      action === "compile"
        ? await compile(args)
        : action === "stream-open"
          ? streamOpen(args)
          : action === "stream-chunk"
            ? streamState.chunk(args.stream_id, args.chunk)
            : action === "stream-end"
              ? streamState.end(args.stream_id)
              : action === "stream-abort"
                ? streamState.abort(args.stream_id)
                : action === "profiles"
                  ? profiles()
                  : action === "variants"
                    ? variants(args)
                    : action === "request"
                      ? requestContract(args)
                      : action === "response"
                        ? responseContract(args)
                        : action === "encode"
                          ? wireRequest(args)
                          : action === "decode"
                            ? wireResponse(args)
                            : action === "links"
                              ? await linked(args)
                              : action === "callbacks"
                                ? callbacks(args)
                                : action === "webhooks"
                                  ? (modernPrepared?.webhookOperations.map(
                                      (r) => ({
                                        name: r.route,
                                        id: r.id,
                                        method: r.method,
                                      }),
                                    ) ?? [])
                                  : action === "webhook"
                                    ? webhookContract(args)
                                    : action === "callback"
                                      ? callbackContract(args)
                                      : action === "wire-request"
                                        ? wireRequestContract(args)
                                        : fail("STANDARD_UNKNOWN_ACTION");
    parentPort.postMessage(encodeTransfer({ id, ok: true, value }));
  } catch (error) {
    // Library exceptions can contain document fragments, filesystem paths,
    // examples, or credentials. Never propagate their messages/stacks.
    parentPort.postMessage(
      encodeTransfer({
        id,
        ok: false,
        code: missingReference
          ? "STANDARD_REFERENCE_NOT_GRANTED"
          : /^(?:STANDARD|MODERN)_[A-Z0-9_]+$/.test(
                error.code ?? error.message ?? "",
              )
            ? (error.code ?? error.message)
            : "STANDARD_VALIDATION_ERROR",
      }),
    );
  }
});

// OpenAPI 3.1/3.2 native media semantics. Exact values remain exact; schema
// dialects are never rewritten into 3.0 and format is never a wire-encoding hint.
import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { setImmediate } from "node:timers/promises";
import {
  numeric,
  number,
  decimal,
  parseExact,
  stringifyExact,
  setOwn,
} from "./standard-value.mjs";
import { within } from "./adapters.mjs";
import { encodeModernXML, decodeModernXML } from "./modern-xml.mjs";
import { encodeLinkset, decodeLinkset } from "./modern-linkset.mjs";

const has = (o, k) => Object.hasOwn(o ?? {}, k);
const token = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const fail = (code) => {
  throw new Error("MODERN_" + code);
};
const utf8 = (bytes) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const base = (media) =>
  String(media || "application/octet-stream")
    .split(";")[0]
    .trim()
    .toLowerCase();
const fixedMethods = new Set([
  "GET",
  "PUT",
  "POST",
  "DELETE",
  "OPTIONS",
  "HEAD",
  "PATCH",
  "TRACE",
  "QUERY",
]);
export function normalizeModernMethod(method, { fixed = false } = {}) {
  if (typeof method !== "string" || method.length > 64 || !token.test(method))
    fail("METHOD_TOKEN");
  if (fixed) {
    method = method.toUpperCase();
    if (!fixedMethods.has(method)) fail("METHOD_FIXED");
  }
  return method;
}
export const isReadOnlyMethod = (method) =>
  ["GET", "HEAD", "OPTIONS", "QUERY"].includes(normalizeModernMethod(method));
export const sequenceMedia = (media) =>
  [
    "application/jsonl",
    "application/x-ndjson",
    "application/json-seq",
    "application/geo+json-seq",
    "text/event-stream",
  ].includes(base(media)) ||
  /^[!#$%&'*+.^_`|~0-9a-z-]+\/[!#$%&'*+.^_`|~0-9a-z-]+\+json-seq$/.test(
    base(media),
  ) ||
  (base(media).startsWith("multipart/") &&
    base(media) !== "multipart/form-data");
export const hasModernMedia = (media) =>
  sequenceMedia(media) ||
  /^(?:application\/(?:json|.*\+json|jsonl|x-ndjson|json-seq|geo\+json-seq|xml|.*\+xml|linkset|x-www-form-urlencoded|octet-stream)|text\/[^;]+|multipart\/[^;]+|image\/[^;]+|audio\/[^;]+|video\/[^;]+|font\/[^;]+)$/.test(
    base(media),
  );
function concrete(media) {
  if (
    typeof media !== "string" ||
    !media ||
    media.length > 1024 ||
    /[\x00-\x08\x0a-\x1f\x7f]/.test(media)
  )
    fail("MEDIA_TYPE");
  const [kind, sub] = base(media).split("/");
  if (
    !kind ||
    !sub ||
    !/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(kind) ||
    !/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(sub)
  )
    fail("MEDIA_TYPE");
  if (!media.includes("*")) return media;
  if (kind === "*" && sub === "*") return "application/octet-stream";
  const chosen =
    {
      text: "plain",
      image: "png",
      audio: "mpeg",
      video: "mp4",
      application: "octet-stream",
    }[kind] ?? "octet-stream";
  return (
    kind +
    "/" +
    sub.replace("*", chosen) +
    media.slice(media.indexOf(";") < 0 ? media.length : media.indexOf(";"))
  );
}
function checkBudget(options, state) {
  const maxBytes = options.maxBytes ?? 1048576,
    maxItems = options.maxItems ?? 256,
    maxItemBytes = options.maxItemBytes ?? 65536;
  if (
    ![maxBytes, maxItems, maxItemBytes].every(Number.isInteger) ||
    maxBytes < 1 ||
    maxBytes > 1048576 ||
    maxItems < 1 ||
    maxItems > 256 ||
    maxItemBytes < 1 ||
    maxItemBytes > 1048576 ||
    (state?.depth ?? 0) > 8
  )
    fail("MEDIA_BUDGET");
  return { maxBytes, maxItems, maxItemBytes };
}
function acceptable(result) {
  return result === true || result?.valid === true;
}
function validates(options, schema, value) {
  return !options.validate || acceptable(options.validate(schema, value));
}
// Metadata inspection is distinct from schema evaluation. All original schemas
// are still passed to the caller's exact validator, never narrowed for validation.
export function mediaSchema(
  schema = {},
  value,
  options = {},
  seen = new Set(),
) {
  if (schema === false || schema === true) return {};
  if (
    !schema ||
    typeof schema !== "object" ||
    seen.has(schema) ||
    seen.size > 128
  )
    return {};
  seen = new Set(seen).add(schema);
  if (options.resolveSchema) {
    const resolved = options.resolveSchema(schema, value);
    // A native resolver returns an already-inspected view tied to its original
    // schema/base URI. Keep that identity for exact validation and annotations.
    if (resolved !== undefined && resolved !== schema)
      return resolved === false || resolved === true ? {} : resolved;
  }
  const out = { ...schema };
  const merge = (child) => {
    const c = mediaSchema(child, value, options, seen);
    if (c.type !== undefined) {
      const incoming = Array.isArray(c.type) ? c.type : [c.type];
      out.type =
        out.type === undefined
          ? c.type
          : [
              ...new Set(
                (Array.isArray(out.type) ? out.type : [out.type]).flatMap((a) =>
                  incoming.flatMap((b) =>
                    a === b
                      ? [a]
                      : [a, b].every((t) => ["number", "integer"].includes(t))
                        ? ["integer"]
                        : [],
                  ),
                ),
              ),
            ];
      if (Array.isArray(out.type) && out.type.length === 1)
        out.type = out.type[0];
    }
    for (const key of ["properties", "patternProperties"])
      if (c[key]) {
        out[key] = { ...(out[key] ?? {}) };
        for (const [k, v] of Object.entries(c[key]))
          setOwn(
            out[key],
            k,
            has(out[key], k) ? { allOf: [out[key][k], v] } : v,
          );
      }
    for (const key of [
      "items",
      "prefixItems",
      "additionalProperties",
      "xml",
      "contentEncoding",
      "contentMediaType",
    ])
      if (!has(out, key) && has(c, key)) out[key] = c[key];
  };
  for (const s of schema.allOf ?? []) merge(s);
  const choices = schema.oneOf ?? schema.anyOf;
  if (choices?.length) {
    const actual =
      value === null
        ? "null"
        : Buffer.isBuffer(value) || value instanceof Uint8Array
          ? "binary"
          : numeric(value)
            ? "number"
            : Array.isArray(value)
              ? "array"
              : typeof value;
    const candidates = choices.filter((s) =>
      value !== undefined
        ? options.validate
          ? validates(options, s, value)
          : !s.type ||
            (Array.isArray(s.type) ? s.type : [s.type]).some(
              (t) => t === actual || (t === "integer" && actual === "number"),
            )
        : true,
    );
    if (candidates.length === 1) merge(candidates[0]);
  }
  return out;
}
function wireType(schema, value) {
  const types = Array.isArray(schema?.type)
    ? schema.type
    : schema?.type
      ? [schema.type]
      : [];
  const actual =
    value === undefined
      ? undefined
      : value === null
        ? "null"
        : numeric(value)
          ? "number"
          : Array.isArray(value)
            ? "array"
            : typeof value;
  return types.includes(actual)
    ? actual
    : types.includes("string")
      ? "string"
      : (types.find((t) => t !== "null") ?? actual);
}
function cast(schema, value, options) {
  // Parsing itself is not a successful contract verdict. Keep an invalid
  // lexical value for the enclosing item/whole validator to reject precisely.
  return modernWireCandidates(schema, value, options)[0] ?? value;
}
export function modernWireCandidates(schema, value, options = {}) {
  if (typeof value !== "string") return [value];
  const s = mediaSchema(schema, undefined, options),
    t = wireType(s);
  const values = [value];
  try {
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value))
      values.push(number(value));
  } catch {}
  if (["true", "false"].includes(value)) values.push(value === "true");
  if (value === "" || value === "null") values.push(null);
  const kind = (v) => (v === null ? "null" : numeric(v) ? "number" : typeof v);
  values.sort(
    (a, b) =>
      Number(kind(b) === t || (t === "integer" && numeric(b))) -
      Number(kind(a) === t || (t === "integer" && numeric(a))),
  );
  return values.filter(
    (v, i) =>
      values.findIndex((x) => stringifyExact(x) === stringifyExact(v)) === i &&
      (!options.validate || validates(options, schema ?? true, v)),
  );
}
export function castModernWire(schema, value, options = {}) {
  const values = modernWireCandidates(schema, value, options);
  if (!values.length) fail("WIRE_VALUE_CONTRACT");
  return values[0];
}
function combinations(values, array = false) {
  // Keep a distinct resource verdict when a valid coercion may be outside the
  // bounded search. Exhaustion is not evidence of an interface defect.
  let count = 1;
  for (const [, candidates] of values) {
    if (!candidates.length) return [];
    count = Math.min(65, count * candidates.length);
  }
  let out = [array ? [] : {}];
  for (const [key, candidates] of values) {
    const next = [];
    outer: for (const existing of out)
      for (const value of candidates) {
        const changed = array ? [...existing, value] : { ...existing };
        if (!array) setOwn(changed, key, value);
        next.push(changed);
        if (next.length >= 64) break outer;
      }
    out = next.slice(0, 64);
    if (!out.length) break;
  }
  Object.defineProperty(out, "truncated", { value: count > 64 });
  return out;
}
export const modernWireCombinations = combinations;
export function chooseModernWire(schema, candidates, options = {}) {
  const filtered = candidates.filter((v) => v !== undefined);
  if (options.validate) {
    for (const candidate of filtered)
      if (validates(options, schema ?? true, candidate)) return candidate;
    fail(
      candidates.truncated || options.wireCandidatesTruncated
        ? "WIRE_COERCION_BUDGET"
        : "WIRE_VALUE_CONTRACT",
    );
  }
  return filtered[0];
}
export function decodeModernHeader(header, wire, options = {}) {
  if (wire === undefined || wire === null) return undefined;
  if (Array.isArray(wire)) wire = wire.join(", ");
  if (
    typeof wire !== "string" ||
    wire.length > 65536 ||
    /[\x00-\x08\x0a-\x1f\x7f]/.test(wire)
  )
    fail("HEADER_WIRE");
  const media =
    typeof header.content === "string"
      ? header.content
      : Object.keys(header.content ?? {})[0];
  if (media)
    return decodeModernMedia(
      media,
      Buffer.from(wire),
      header.contentDefinition?.[media] ??
        (typeof header.content === "object"
          ? header.content[media]
          : { schema: header.schema }),
      { ...options, header: true },
    );
  const schema = header.schema ?? true,
    s = mediaSchema(schema, undefined, options),
    t = wireType(s),
    pieces = wire.split(",").map((v) => v.replace(/^[ \t]*|[ \t]*$/g, ""));
  if (pieces.length > 256) fail("HEADER_BUDGET");
  const arrays = combinations(
    pieces.map((v, i) => [
      i,
      modernWireCandidates(s.prefixItems?.[i] ?? s.items, v, options),
    ]),
    true,
  );
  if (wire === "") arrays.unshift([]);
  const objectValues = [];
  let valid = true;
  if (header.explode)
    for (const v of pieces) {
      const i = v.indexOf("=");
      if (i < 0) {
        valid = false;
        break;
      }
      const key = v.slice(0, i).replace(/^[ \t]*|[ \t]*$/g, "");
      if (objectValues.some(([k]) => k === key)) {
        valid = false;
        break;
      }
      objectValues.push([
        key,
        modernWireCandidates(
          property(s, key),
          v.slice(i + 1).replace(/^[ \t]*|[ \t]*$/g, ""),
          options,
        ),
      ]);
    }
  else if (pieces.length % 2 === 0)
    for (let i = 0; i < pieces.length; i += 2)
      objectValues.push([
        pieces[i],
        modernWireCandidates(property(s, pieces[i]), pieces[i + 1], options),
      ]);
  else valid = false;
  const objects = valid ? combinations(objectValues) : [];
  if (wire === "") objects.unshift({});
  const primitives = modernWireCandidates(schema, wire, options);
  return chooseModernWire(
    schema,
    t === "array"
      ? [...arrays, ...primitives, ...objects]
      : t === "object"
        ? [...objects, ...primitives, ...arrays]
        : [...primitives, ...arrays, ...objects],
    {
      ...options,
      wireCandidatesTruncated: arrays.truncated || objects.truncated,
    },
  );
}
function property(s, name) {
  return has(s.properties, name)
    ? s.properties[name]
    : s.additionalProperties && typeof s.additionalProperties === "object"
      ? s.additionalProperties
      : {};
}
const leaf = (v) =>
  v === null
    ? ""
    : typeof v === "object" && !numeric(v)
      ? stringifyExact(v)
      : String(v);
const formToken = (v) =>
  encodeURIComponent(String(v))
    .replace(
      /[!'()*]/g,
      (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
    )
    .replace(/%20/g, "+");
const styled = (e) =>
  ["style", "explode", "allowReserved"].some((k) => has(e, k));
function styledPairs(name, value, e) {
  const style = e.style ?? "form",
    explode = e.explode ?? style === "form";
  if (
    !["form", "deepObject", "spaceDelimited", "pipeDelimited"].includes(style)
  )
    fail("FORM_STYLE");
  const object =
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !numeric(value) &&
    !Buffer.isBuffer(value);
  if (object && style === "deepObject")
    return Object.entries(value).map(([k, v]) => [
      name + "[" + k + "]",
      leaf(v),
    ]);
  if (object && style === "form" && explode)
    return Object.entries(value).map(([k, v]) => [k, leaf(v)]);
  if (Array.isArray(value) && style === "form" && explode)
    return value.map((v) => [name, leaf(v)]);
  if (Array.isArray(value) || object) {
    const values = object ? Object.entries(value).flat() : value;
    return [
      [
        name,
        values
          .map(leaf)
          .join(
            style === "spaceDelimited"
              ? " "
              : style === "pipeDelimited"
                ? "|"
                : ",",
          ),
      ],
    ];
  }
  return [[name, leaf(value)]];
}
function defaultMedia(schema, value, options) {
  const s = mediaSchema(schema, value, options),
    t = wireType(s, value);
  if (!has(s, "type") || (t === "string" && has(s, "contentEncoding")))
    return "application/octet-stream";
  return t === "object" || t === "array" ? "application/json" : "text/plain";
}
function pickMedia(encoding, schema, value, path, options) {
  const choices = mediaChoices(
    encoding.contentType ?? defaultMedia(schema, value, options),
  );
  const requested = options.partMediaTypes?.[path];
  const choice = requested ?? concrete(choices[0]);
  if (!choices.some((range) => matchesMedia(range, choice)))
    fail("PART_MEDIA_CHOICE");
  return choice;
}
function mediaChoices(source) {
  if (
    typeof source !== "string" ||
    source.length > 4096 ||
    /[\x00-\x08\x0a-\x1f\x7f]/.test(source)
  )
    fail("MEDIA_TYPE");
  const result = [];
  let start = 0,
    quote = false,
    escaped = false;
  for (let i = 0; i < source.length; i++) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote && source[i] === "\\") {
      escaped = true;
      continue;
    }
    if (source[i] === '"') quote = !quote;
    else if (!quote && source[i] === ",") {
      result.push(source.slice(start, i).trim());
      start = i + 1;
    }
  }
  result.push(source.slice(start).trim());
  if (quote || escaped || result.some((v) => !v)) fail("MEDIA_TYPE");
  return result;
}
function matchesMedia(range, actual) {
  const a = base(actual),
    r = base(range);
  return (
    r === a ||
    r === "*/*" ||
    r === a.split("/")[0] + "/*" ||
    (r.includes("*+") &&
      a.startsWith(r.split("*")[0]) &&
      a.endsWith(r.split("*")[1]))
  );
}
export function assertModernMedia(media, content = {}) {
  const m = base(media);
  if (
    content.encoding !== undefined &&
    (content.prefixEncoding !== undefined || content.itemEncoding !== undefined)
  )
    fail("ENCODING_CONFLICT");
  if (
    content.prefixEncoding !== undefined &&
    !Array.isArray(content.prefixEncoding)
  )
    fail("ENCODING_SHAPE");
  if (
    content.itemEncoding !== undefined &&
    (!content.itemEncoding ||
      typeof content.itemEncoding !== "object" ||
      Array.isArray(content.itemEncoding))
  )
    fail("ENCODING_SHAPE");
  if (m.startsWith("multipart/"))
    for (const e of [
      ...Object.values(content.encoding ?? {}),
      ...(content.prefixEncoding ?? []),
      ...(content.itemEncoding ? [content.itemEncoding] : []),
    ]) {
      if (!e || typeof e !== "object" || Array.isArray(e))
        fail("ENCODING_SHAPE");
      if (
        has(e, "encoding") &&
        (has(e, "prefixEncoding") || has(e, "itemEncoding"))
      )
        fail("ENCODING_CONFLICT");
    }
  return true;
}
function headerValue(header) {
  if (has(header, "__wireValue")) return header.__wireValue;
  if (has(header, "example")) return header.example;
  if (has(header, "schema")) {
    for (const k of ["const", "default", "example"])
      if (has(header.schema, k)) return header.schema[k];
    if (header.schema.enum?.length) return header.schema.enum[0];
  }
  for (const e of Object.values(header.examples ?? {}))
    for (const k of ["dataValue", "value", "serializedValue"])
      if (has(e, k)) return e[k];
  return undefined;
}
function parseHeader(h, value, options) {
  const media = Object.keys(h.content ?? {})[0];
  if (media)
    return decodeModernMedia(
      media,
      Buffer.from(value),
      h.content[media],
      options,
    );
  const s = mediaSchema(h.schema, undefined, options),
    t = wireType(s);
  if (t === "array")
    return value.split(",").map((v) => cast(s.items, v.trim(), options));
  if (t === "object") {
    const out = {},
      pieces = value.split(",");
    if (h.explode)
      for (const piece of pieces) {
        const i = piece.indexOf("=");
        if (i < 0) fail("PART_HEADER_SCHEMA");
        const k = piece.slice(0, i).trim();
        setOwn(
          out,
          k,
          cast(property(s, k), piece.slice(i + 1).trim(), options),
        );
      }
    else {
      if (pieces.length % 2) fail("PART_HEADER_SCHEMA");
      for (let i = 0; i < pieces.length; i += 2) {
        const k = pieces[i].trim();
        setOwn(out, k, cast(property(s, k), pieces[i + 1].trim(), options));
      }
    }
    return out;
  }
  return cast(s, value, options);
}
function validateHeaders(encoding, headers, options) {
  for (const [name, h] of Object.entries(encoding.headers ?? {})) {
    if (name.toLowerCase() === "content-type") continue;
    const value = headers[name.toLowerCase()];
    if (value === undefined) {
      if (h.required) fail("PART_HEADER_REQUIRED");
      continue;
    }
    const media = Object.keys(h.content ?? {})[0],
      schema = media ? h.content[media].schema : h.schema;
    if (!validates(options, schema ?? true, parseHeader(h, value, options)))
      fail("PART_HEADER_SCHEMA");
  }
}
function multipartParts(media, value, content, options, state) {
  const s = mediaSchema(content.schema, value, options),
    positional = Array.isArray(value);
  if (
    !positional &&
    (!value ||
      typeof value !== "object" ||
      numeric(value) ||
      Buffer.isBuffer(value))
  )
    fail("MULTIPART_DATA");
  if (!positional && base(media) !== "multipart/form-data" && !content.encoding)
    fail("MULTIPART_POSITIONAL_REQUIRED");
  const specs = positional
    ? value.map((v, i) => ({
        value: v,
        defaultName:
          base(media) === "multipart/form-data" ? String(i) : undefined,
        schema: s.prefixItems?.[i] ?? s.items ?? content.itemSchema ?? {},
        encoding:
          content.prefixEncoding?.[i] ??
          (i >= (content.prefixEncoding?.length ?? 0)
            ? content.itemEncoding
            : undefined) ??
          {},
        path: state.path + "/" + i,
      }))
    : Object.entries(value).flatMap(([name, v]) => {
        const p = mediaSchema(property(s, name), v, options),
          e = content.encoding?.[name] ?? {};
        return (Array.isArray(v) ? v : [v]).map((item, i) => ({
          value: item,
          name,
          schema: Array.isArray(v) ? (p.prefixItems?.[i] ?? p.items ?? {}) : p,
          encoding: e,
          path: state.path + "/" + name + (Array.isArray(v) ? "/" + i : ""),
        }));
      });
  const parts = [];
  for (const p of specs) {
    if (++state.shared.parts > 256) fail("MULTIPART_PART_BUDGET");
    if (
      positional &&
      content.itemSchema !== undefined &&
      !validates(options, content.itemSchema, p.value)
    )
      fail("SEQUENCE_ITEM_SCHEMA");
    const ps = mediaSchema(p.schema, p.value, options),
      e = p.encoding;
    const mt = pickMedia(e, ps, p.value, p.path, options);
    const encoded =
      styled(e) && base(media) === "multipart/form-data"
        ? { body: Buffer.from(leaf(p.value)), contentType: "text/plain" }
        : encodeInner(
            mt,
            p.value,
            {
              schema: ps,
              encoding: e.encoding,
              prefixEncoding: e.prefixEncoding,
              itemEncoding: e.itemEncoding,
            },
            options,
            { ...state, depth: state.depth + 1, path: p.path },
          );
    const headers = { "content-type": encoded.contentType };
    for (const [name, h] of Object.entries(e.headers ?? {})) {
      const k = name.toLowerCase();
      if (k === "content-type") continue;
      const v = headerValue(h);
      if (v === undefined) {
        if (h.required) fail("PART_HEADER_VALUE_REQUIRED");
        continue;
      }
      if (!token.test(name) || /[\x00-\x08\x0a-\x1f\x7f]/.test(leaf(v)))
        fail("PART_HEADER");
      setOwn(headers, k, leaf(v));
    }
    if (p.name !== undefined) {
      if (/[\r\n\x00]/.test(p.name)) fail("PART_NAME");
      const expected =
        'form-data; name="' + p.name.replace(/["\\]/g, "\\$&") + '"';
      if (!has(headers, "content-disposition"))
        headers["content-disposition"] = expected;
      const match = /(?:^|;)\s*name="((?:\\.|[^"\\])*)"/.exec(
        headers["content-disposition"],
      );
      if (!match || match[1].replace(/\\(.)/g, "$1") !== p.name)
        fail("PART_DISPOSITION");
    }
    if (p.defaultName !== undefined && !has(headers, "content-disposition"))
      headers["content-disposition"] =
        'form-data; name="' + p.defaultName + '"';
    if (has(ps, "contentEncoding") && typeof ps.contentEncoding === "string") {
      if (!token.test(ps.contentEncoding)) fail("PART_TRANSFER_ENCODING");
      if (
        has(headers, "content-transfer-encoding") &&
        headers["content-transfer-encoding"].toLowerCase() !==
          ps.contentEncoding.toLowerCase()
      )
        fail("PART_TRANSFER_ENCODING_CONFLICT");
      headers["content-transfer-encoding"] = ps.contentEncoding;
    }
    validateHeaders(e, headers, options);
    const rawHeaders = Object.entries(headers)
      .map(([k, v]) => k + ": " + v)
      .join("\r\n");
    if (Buffer.byteLength(rawHeaders) > 16384) fail("PART_HEADER_BUDGET");
    parts.push(
      Buffer.concat([Buffer.from(rawHeaders + "\r\n\r\n"), encoded.body]),
    );
  }
  let boundary;
  do {
    boundary = "moonapi-modern-" + randomBytes(18).toString("hex");
  } while (parts.some((p) => p.includes(boundary)));
  const body = Buffer.concat([
    ...parts.flatMap((p) => [
      Buffer.from("--" + boundary + "\r\n"),
      p,
      Buffer.from("\r\n"),
    ]),
    Buffer.from("--" + boundary + "--\r\n"),
  ]);
  return { body, contentType: base(media) + "; boundary=" + boundary };
}
// A boundary is a complete delimiter line, not a substring in binary data or
// a similarly-prefixed preamble line. MIME transport padding is insignificant.
function boundaryTail(bytes, after, final = true) {
  let position = after,
    closing = false;
  if (bytes.length < position + 2) return final ? false : undefined;
  if (bytes.subarray(position, position + 2).toString() === "--") {
    closing = true;
    position += 2;
  }
  while (bytes[position] === 32 || bytes[position] === 9) position++;
  if (closing && final && position === bytes.length)
    return { closing, end: position };
  if (bytes.length < position + 2) return final ? false : undefined;
  return bytes[position] === 13 && bytes[position + 1] === 10
    ? { closing, end: position + 2 }
    : false;
}
function validBoundary(value) {
  return (
    typeof value === "string" &&
    /^[0-9A-Za-z'()+_,./:=? -]{1,70}$/.test(value) &&
    !value.endsWith(" ")
  );
}
function openingBoundary(bytes, marker, final = true) {
  let at = bytes.indexOf(marker);
  while (at >= 0) {
    if (at === 0 || bytes.subarray(at - 2, at).toString() === "\r\n") {
      const tail = boundaryTail(bytes, at + marker.length, final);
      if (tail === undefined) return { pending: true, at };
      if (tail) return { at, ...tail };
    }
    at = bytes.indexOf(marker, at + marker.length);
  }
  return undefined;
}
function parseMultipart(media, bytes, content, options, state) {
  const b = /(?:^|;)\s*boundary=(?:"([^"\r\n]+)"|([^;\s]+))/i.exec(media),
    boundary = b?.[1] ?? b?.[2];
  if (!validBoundary(boundary)) fail("MULTIPART_BOUNDARY");
  const marker = Buffer.from("--" + boundary),
    delimiter = Buffer.from("\r\n--" + boundary),
    s = mediaSchema(content.schema, undefined, options);
  const positional =
    base(media) !== "multipart/form-data" ||
    wireType(s) === "array" ||
    content.prefixEncoding !== undefined ||
    content.itemEncoding !== undefined;
  const output = positional ? [] : {};
  let opening = openingBoundary(bytes, marker),
    closed = false;
  if (!opening) fail("MULTIPART_FRAMING");
  let index = 0;
  while (opening) {
    if (opening.closing) {
      closed = true;
      break;
    }
    const at = opening.end;
    const split = bytes.indexOf(Buffer.from("\r\n\r\n"), at);
    let end = at,
      next;
    for (;;) {
      end = bytes.indexOf(delimiter, end);
      if (end < 0) fail("MULTIPART_TRUNCATED");
      const tail = boundaryTail(bytes, end + delimiter.length);
      if (tail) {
        next = { at: end + 2, ...tail };
        break;
      }
      end += delimiter.length;
    }
    if (
      split < 0 ||
      split > end ||
      split - at > 16384 ||
      ++state.shared.parts > 256
    )
      fail("MULTIPART_PART_BUDGET");
    const headers = {};
    for (const line of utf8(bytes.subarray(at, split)).split("\r\n")) {
      const colon = line.indexOf(":");
      if (colon < 1 || !token.test(line.slice(0, colon))) fail("PART_HEADER");
      const k = line.slice(0, colon).toLowerCase(),
        v = line.slice(colon + 1).replace(/^[ \t]*|[ \t]*$/g, "");
      if (/[\x00-\x08\x0a-\x1f\x7f]/.test(v)) fail("PART_HEADER");
      if (has(headers, k)) {
        if (
          [
            "content-type",
            "content-disposition",
            "content-transfer-encoding",
          ].includes(k)
        )
          fail("PART_HEADER_DUPLICATE");
        headers[k] += ", " + v;
      } else setOwn(headers, k, v);
    }
    let name;
    if (!positional) {
      const m = /(?:^|;)\s*name="((?:\\.|[^"\\])*)"/.exec(
        headers["content-disposition"] ?? "",
      );
      if (!m) fail("PART_NAME");
      name = m[1].replace(/\\(.)/g, "$1");
    }
    const ps = positional
        ? (s.prefixItems?.[index] ?? s.items ?? content.itemSchema ?? {})
        : property(s, name),
      inspected = mediaSchema(ps, undefined, options);
    const p =
      !positional && wireType(inspected) === "array"
        ? (inspected.prefixItems?.[output[name]?.length ?? 0] ??
          inspected.items ??
          {})
        : ps;
    const encoding = positional
      ? (content.prefixEncoding?.[index] ??
        (index >= (content.prefixEncoding?.length ?? 0)
          ? content.itemEncoding
          : undefined) ??
        {})
      : (content.encoding?.[name] ?? {});
    const mt = headers["content-type"] ?? defaultMedia(p, undefined, options);
    if (
      encoding.contentType &&
      !mediaChoices(encoding.contentType).some((r) => matchesMedia(r, mt))
    )
      fail("PART_CONTENT_TYPE");
    if (
      headers["content-transfer-encoding"] &&
      inspected.contentEncoding &&
      headers["content-transfer-encoding"].toLowerCase() !==
        inspected.contentEncoding.toLowerCase()
    )
      fail("PART_TRANSFER_ENCODING_CONFLICT");
    validateHeaders(encoding, headers, options);
    const value =
      styled(encoding) && base(media) === "multipart/form-data"
        ? cast(p, utf8(bytes.subarray(split + 4, end)), options)
        : decodeInner(
            mt,
            bytes.subarray(split + 4, end),
            {
              schema: p,
              encoding: encoding.encoding,
              prefixEncoding: encoding.prefixEncoding,
              itemEncoding: encoding.itemEncoding,
            },
            options,
            {
              ...state,
              depth: state.depth + 1,
              path: state.path + "/" + (name ?? index),
            },
          );
    if (positional) output.push(value);
    else if (wireType(inspected) === "array") {
      if (!has(output, name)) setOwn(output, name, []);
      output[name].push(value);
    } else if (has(output, name)) {
      if (!Array.isArray(output[name])) setOwn(output, name, [output[name]]);
      output[name].push(value);
    } else setOwn(output, name, value);
    index++;
    opening = next;
  }
  if (!closed) fail("MULTIPART_TRUNCATED");
  return output;
}
class SequenceParser {
  constructor(media, content, options) {
    this.media =
      /^[!#$%&'*+.^_`|~0-9a-z-]+\/[!#$%&'*+.^_`|~0-9a-z-]+\+json-seq$/.test(
        base(media),
      )
        ? "application/json-seq"
        : base(media);
    this.content = content;
    this.options = options;
    this.budget = checkBudget(options);
    this.buffer = "";
    this.items = [];
    this.bytes = 0;
    this.started = false;
    this.data = [];
    this.event = undefined;
    this.id = undefined;
    this.retry = undefined;
    this.eventBytes = 0;
  }
  add(value) {
    if (this.items.length >= this.budget.maxItems) fail("SEQUENCE_ITEM_BUDGET");
    if (
      has(this.content, "itemSchema") &&
      !validates(this.options, this.content.itemSchema, value)
    )
      fail("SEQUENCE_ITEM_SCHEMA");
    this.options.onItem?.(value, this.items.length);
    this.items.push(value);
  }
  json(text, final = false) {
    if (Buffer.byteLength(text) > this.budget.maxItemBytes)
      fail("SEQUENCE_RECORD_BUDGET");
    let value;
    try {
      value = parseExact(text);
    } catch {
      fail("SEQUENCE_JSON");
    }
    if (
      final &&
      !/[\r\n]\s*$/.test(text) &&
      (numeric(value) || value === null || typeof value === "boolean")
    )
      fail("SEQUENCE_TRUNCATED_SCALAR");
    this.add(value);
  }
  line(text) {
    if (Buffer.byteLength(text) > this.budget.maxItemBytes)
      fail("SEQUENCE_RECORD_BUDGET");
    if (this.media !== "text/event-stream") {
      if (text.trim()) this.json(text);
      else if (this.media === "application/jsonl") fail("SEQUENCE_EMPTY_JSONL");
      return;
    }
    if (text === "") {
      if (this.data.length)
        this.add({
          data: this.data.join("\n"),
          ...(this.event === undefined
            ? {}
            : { event: this.event || "message" }),
          ...(this.id === undefined ? {} : { id: this.id }),
          ...(this.retry === undefined ? {} : { retry: this.retry }),
        });
      this.data = [];
      this.event = undefined;
      this.retry = undefined;
      this.eventBytes = 0;
      return;
    }
    if ((this.eventBytes += Buffer.byteLength(text)) > this.budget.maxItemBytes)
      fail("SEQUENCE_RECORD_BUDGET");
    if (text.startsWith(":")) return;
    const colon = text.indexOf(":"),
      field = colon < 0 ? text : text.slice(0, colon);
    let v = colon < 0 ? "" : text.slice(colon + 1);
    if (v.startsWith(" ")) v = v.slice(1);
    if (field === "data") this.data.push(v);
    else if (field === "event") this.event = v;
    else if (field === "id" && !v.includes("\0")) this.id = v;
    else if (field === "retry" && /^\d+$/.test(v)) {
      try {
        this.retry = number(v.replace(/^0+(?=\d)/, ""));
      } catch {
        fail("SEQUENCE_NUMBER_BUDGET");
      }
    }
  }
  feed(text, final = false) {
    this.buffer += text;
    if (
      ["application/json-seq", "application/geo+json-seq"].includes(this.media)
    ) {
      for (;;) {
        const at = this.buffer.indexOf("\x1e");
        if (at < 0) break;
        const before = this.buffer.slice(0, at);
        if (this.started) this.json(before, true);
        else if (before.trim()) fail("SEQUENCE_FRAMING");
        this.started = true;
        this.buffer = this.buffer.slice(at + 1);
      }
      if (final && this.buffer.trim()) {
        if (!this.started) fail("SEQUENCE_FRAMING");
        this.json(this.buffer, true);
        this.buffer = "";
      } else if (final && this.started) fail("SEQUENCE_JSON");
    } else {
      for (;;) {
        const m = /[\r\n]/.exec(this.buffer);
        if (!m) break;
        const at = m.index;
        if (!final && this.buffer[at] === "\r" && at === this.buffer.length - 1)
          break;
        this.line(this.buffer.slice(0, at));
        this.buffer = this.buffer.slice(
          at +
            (this.buffer[at] === "\r" && this.buffer[at + 1] === "\n" ? 2 : 1),
        );
      }
      if (final && this.buffer && this.media !== "text/event-stream") {
        this.line(this.buffer);
        this.buffer = "";
      }
    }
    if (Buffer.byteLength(this.buffer) > this.budget.maxItemBytes)
      fail("SEQUENCE_RECORD_BUDGET");
  }
  finish() {
    if (
      has(this.content, "schema") &&
      !validates(this.options, this.content.schema, this.items)
    )
      fail("MEDIA_SCHEMA");
    return {
      value: this.items,
      items: this.items,
      complete: true,
      discarded_unterminated_sse_event:
        this.media === "text/event-stream" &&
        (this.data.length > 0 || this.buffer.length > 0),
    };
  }
}
function decodeSequenceBuffer(media, bytes, content, options) {
  const parser = new SequenceParser(media, content, options);
  parser.feed(utf8(bytes), true);
  return parser.finish();
}
function encodeSequence(media, value, content, options) {
  if (!Array.isArray(value)) fail("SEQUENCE_ARRAY_REQUIRED");
  const { maxItems, maxItemBytes } = checkBudget(options);
  if (value.length > maxItems) fail("SEQUENCE_ITEM_BUDGET");
  const m = base(media),
    parts = [];
  for (const item of value) {
    if (
      has(content, "itemSchema") &&
      !validates(options, content.itemSchema, item)
    )
      fail("SEQUENCE_ITEM_SCHEMA");
    let text;
    if (m === "text/event-stream") {
      if (!item || typeof item !== "object" || typeof item.data !== "string")
        fail("SSE_EVENT");
      text = "";
      for (const key of ["event", "id"])
        if (has(item, key)) {
          if (typeof item[key] !== "string" || /[\r\n\0]/.test(item[key]))
            fail("SSE_FIELD");
          text += key + ": " + item[key] + "\n";
        }
      if (has(item, "retry")) {
        if (!numeric(item.retry)) fail("SSE_FIELD");
        const [coefficient, exponent] = decimal(item.retry);
        if (coefficient < 0n || exponent < 0) fail("SSE_FIELD");
        text +=
          "retry: " + (coefficient * 10n ** BigInt(exponent)).toString() + "\n";
      }
      text +=
        item.data
          .split(/\r\n|\r|\n/)
          .map((line) => "data: " + line + "\n")
          .join("") + "\n";
    } else
      text =
        (m.endsWith("json-seq") ? "\x1e" : "") + stringifyExact(item) + "\n";
    if (Buffer.byteLength(text) > maxItemBytes) fail("SEQUENCE_RECORD_BUDGET");
    parts.push(text);
  }
  return Buffer.from(parts.join(""));
}
function encodeForm(value, content, options, state) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    numeric(value) ||
    Buffer.isBuffer(value)
  )
    fail("FORM_OBJECT_REQUIRED");
  const s = mediaSchema(content.schema, value, options),
    pairs = [];
  for (const [name, v] of Object.entries(value)) {
    const e = content.encoding?.[name] ?? {},
      ps = mediaSchema(property(s, name), v, options);
    if (styled(e)) pairs.push(...styledPairs(name, v, e));
    else
      for (const item of Array.isArray(v) ? v : [v]) {
        const p = Array.isArray(v) ? (ps.items ?? {}) : ps;
        const mt = pickMedia(e, p, item, state.path + "/" + name, options);
        const encoded = encodeInner(
          mt,
          item,
          {
            schema: p,
            encoding: e.encoding,
            prefixEncoding: e.prefixEncoding,
            itemEncoding: e.itemEncoding,
          },
          options,
          { ...state, depth: state.depth + 1 },
        );
        pairs.push([
          name,
          has(p, "contentEncoding") && typeof item === "string"
            ? item
            : utf8(encoded.body),
        ]);
      }
  }
  if (pairs.length > 256) fail("FORM_PAIR_BUDGET");
  return Buffer.from(
    pairs.map(([k, v]) => formToken(k) + "=" + formToken(v)).join("&"),
  );
}
function decodeForm(text, content, options, state) {
  if (/%(?![0-9a-f]{2})/i.test(text)) fail("FORM_PERCENT_ENCODING");
  const parameters = new URLSearchParams(text),
    s = mediaSchema(content.schema, undefined, options),
    output = {},
    consumed = new Set();
  if ([...parameters].length > 256) fail("FORM_PAIR_BUDGET");
  for (const [name, ps] of Object.entries(s.properties ?? {})) {
    const e = content.encoding?.[name] ?? {},
      p = mediaSchema(ps, undefined, options);
    if (
      styled(e) &&
      wireType(p) === "object" &&
      (e.style === "deepObject" ||
        ((e.style ?? "form") === "form" && (e.explode ?? true)))
    ) {
      const result = {};
      for (const [key, v] of parameters) {
        const k =
          e.style === "deepObject"
            ? key.startsWith(name + "[") && key.endsWith("]")
              ? key.slice(name.length + 1, -1)
              : undefined
            : has(p.properties, key) && !has(s.properties, key)
              ? key
              : undefined;
        if (k !== undefined) {
          consumed.add(key);
          setOwn(result, k, cast(property(p, k), v, options));
        }
      }
      if (Object.keys(result).length) setOwn(output, name, result);
    }
  }
  for (const name of new Set(parameters.keys())) {
    if (consumed.has(name)) continue;
    const p = mediaSchema(property(s, name), undefined, options),
      e = content.encoding?.[name] ?? {},
      values = parameters.getAll(name),
      t = wireType(p);
    let result;
    if (styled(e)) {
      if (t === "array")
        result = (
          e.explode === false ||
          ["pipeDelimited", "spaceDelimited"].includes(e.style)
            ? values[0].split(
                e.style === "spaceDelimited"
                  ? " "
                  : e.style === "pipeDelimited"
                    ? "|"
                    : ",",
              )
            : values
        ).map((v) => cast(p.items, v, options));
      else if (t === "object" && e.explode === false) {
        const pieces = values[0].split(",");
        if (pieces.length % 2) fail("FORM_OBJECT_PAIRS");
        result = {};
        for (let i = 0; i < pieces.length; i += 2)
          setOwn(
            result,
            pieces[i],
            cast(property(p, pieces[i]), pieces[i + 1], options),
          );
      } else result = cast(p, values[0], options);
    } else {
      const one = (v) => {
        const item = t === "array" ? (p.items ?? {}) : p;
        return has(item, "contentEncoding")
          ? v
          : decodeInner(
              pickMedia(e, item, undefined, state.path + "/" + name, options),
              Buffer.from(v),
              {
                schema: item,
                encoding: e.encoding,
                prefixEncoding: e.prefixEncoding,
                itemEncoding: e.itemEncoding,
              },
              options,
              { ...state, depth: state.depth + 1 },
            );
      };
      result =
        t === "array" || values.length > 1 ? values.map(one) : one(values[0]);
    }
    setOwn(output, name, result);
  }
  return output;
}
function encodeInner(media, value, content, options, state) {
  const budget = checkBudget(options, state);
  assertModernMedia(media, content);
  media = concrete(media);
  const m = base(media),
    schema = mediaSchema(content.schema, value, options);
  let encoded;
  if (m.startsWith("multipart/"))
    encoded = multipartParts(media, value, content, options, state);
  else if (sequenceMedia(m))
    encoded = {
      body: encodeSequence(m, value, content, options),
      contentType: media,
    };
  else if (m === "application/json" || m.endsWith("+json"))
    encoded = { body: Buffer.from(stringifyExact(value)), contentType: media };
  else if (m === "application/linkset")
    encoded = {
      body: Buffer.from(encodeLinkset(value, options)),
      contentType: media,
    };
  else if (m === "application/xml" || m === "text/xml" || m.endsWith("+xml"))
    encoded = {
      body: Buffer.from(
        encodeModernXML(content.schema ?? true, value, {
          ...options,
          inspectSchema: (s, v) => mediaSchema(s, v, options),
        }),
      ),
      contentType: media,
    };
  else if (m === "application/x-www-form-urlencoded")
    encoded = {
      body: encodeForm(value, content, options, state),
      contentType: media,
    };
  else
    encoded = {
      body:
        Buffer.isBuffer(value) || value instanceof Uint8Array
          ? Buffer.from(value)
          : Buffer.from(leaf(value)),
      contentType: media,
    };
  if (encoded.body.length > budget.maxBytes) fail("MEDIA_BYTE_BUDGET");
  return encoded;
}
function decodeInner(media, raw, content, options, state) {
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw),
    budget = checkBudget(options, state);
  if (bytes.length > budget.maxBytes) fail("MEDIA_BYTE_BUDGET");
  assertModernMedia(media, content);
  const m = base(media),
    schema = mediaSchema(content.schema, undefined, options);
  if (m.startsWith("multipart/")) {
    const value = parseMultipart(media, bytes, content, options, state);
    if (
      Array.isArray(value) &&
      content.itemSchema !== undefined &&
      !value.every((v) => validates(options, content.itemSchema, v))
    )
      fail("SEQUENCE_ITEM_SCHEMA");
    return value;
  }
  if (sequenceMedia(m))
    return decodeSequenceBuffer(m, bytes, content, options).value;
  if (m === "application/json" || m.endsWith("+json")) {
    try {
      return parseExact(utf8(bytes));
    } catch {
      fail("MEDIA_JSON");
    }
  }
  if (m === "application/linkset") return decodeLinkset(bytes, options);
  if (m === "application/xml" || m === "text/xml" || m.endsWith("+xml"))
    return decodeModernXML(content.schema ?? true, utf8(bytes), {
      ...options,
      inspectSchema: (s, v) => mediaSchema(s, v, options),
      castWire: castModernWire,
    });
  if (m === "application/x-www-form-urlencoded")
    return decodeForm(utf8(bytes), content, options, state);
  if (m.startsWith("text/") || has(schema, "type"))
    return cast(schema, utf8(bytes), options);
  return Buffer.from(bytes);
}
export function encodeModernMedia(media, value, content = {}, options = {}) {
  return encodeInner(media, value, content, options, {
    depth: 0,
    path: "",
    shared: { parts: 0 },
  });
}
export function decodeModernMedia(media, raw, content = {}, options = {}) {
  return decodeInner(media, raw, content, options, {
    depth: 0,
    path: "",
    shared: { parts: 0 },
  });
}
export function validateModernContent(content, value, validate) {
  if (typeof validate !== "function") fail("MEDIA_VALIDATOR_REQUIRED");
  if (has(content, "schema") && !acceptable(validate(content.schema, value)))
    return false;
  if (has(content, "itemSchema")) {
    if (!Array.isArray(value)) return false;
    if (!value.every((v) => acceptable(validate(content.itemSchema, v))))
      return false;
  }
  return true;
}
function parameterContent(parameter) {
  if (
    parameter?.in !== "querystring" ||
    (has(parameter, "schema") && typeof parameter.content !== "string") ||
    ["style", "explode", "allowReserved"].some(
      (k) => parameter[k] !== undefined,
    )
  )
    fail("QUERYSTRING_PARAMETER");
  if (typeof parameter.content === "string")
    return {
      media: parameter.content,
      content: parameter.media_object ?? { schema: parameter.schema },
    };
  const keys = Object.keys(parameter.content ?? {});
  if (keys.length !== 1) fail("QUERYSTRING_CONTENT");
  return { media: keys[0], content: parameter.content[keys[0]] };
}
export function encodeQuerystring(parameter, value, options = {}) {
  const { media, content } = parameterContent(parameter),
    text = utf8(encodeModernMedia(media, value, content, options).body);
  if (base(media) === "application/x-www-form-urlencoded") return text;
  return encodeURIComponent(text).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}
export function decodeQuerystring(parameter, wire, options = {}) {
  const { media, content } = parameterContent(parameter);
  if (typeof wire !== "string" || wire.includes("#") || /[\r\n]/.test(wire))
    fail("QUERYSTRING_WIRE");
  let text;
  try {
    text =
      base(media) === "application/x-www-form-urlencoded"
        ? wire
        : decodeURIComponent(wire);
  } catch {
    fail("QUERYSTRING_PERCENT_ENCODING");
  }
  return decodeModernMedia(media, Buffer.from(text), content, options);
}
const uriToken = (value) =>
  encodeURIComponent(String(value)).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
function cookieValue(value) {
  const s = String(value),
    unquoted = s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
  if (!/^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*$/.test(unquoted))
    fail("COOKIE_VALUE_REQUIRES_PREESCAPING");
  return s;
}
function cookieConfig(parameter) {
  const style = parameter.style ?? "form";
  if (
    parameter.in !== "cookie" ||
    !["form", "cookie"].includes(style) ||
    parameter.explode === false ||
    typeof parameter.name !== "string"
  )
    fail("COOKIE_PARAMETER");
  return { style };
}
export function serializeModernCookie(parameter, value, options = {}) {
  const { style } = cookieConfig(parameter);
  const encode =
    style === "cookie"
      ? (v) => String(v)
      : parameter.allowReserved
        ? (v) =>
            uriToken(v)
              .replace(
                /%(?:3A|2F|3F|23|5B|5D|40|21|24|26|27|28|29|2A|2B|3D)/gi,
                (c) => decodeURIComponent(c),
              )
              .replace(/%25([0-9a-f]{2})/gi, "%$1")
        : uriToken;
  let pairs;
  if (parameter.content) {
    const media =
        typeof parameter.content === "string"
          ? parameter.content
          : Object.keys(parameter.content)[0],
      content =
        typeof parameter.content === "string"
          ? (parameter.media_object ?? { schema: parameter.schema })
          : parameter.content[media];
    pairs = [
      [
        parameter.name,
        utf8(encodeModernMedia(media, value, content, options).body),
      ],
    ];
  } else if (Array.isArray(value))
    pairs = value.map((v) => [parameter.name, leaf(v)]);
  else if (value && typeof value === "object" && !numeric(value))
    pairs = Object.entries(value).map(([k, v]) => [k, leaf(v)]);
  else pairs = [[parameter.name, leaf(value)]];
  if (pairs.length > 256) fail("COOKIE_PAIR_BUDGET");
  return pairs.map(([name, v]) => {
    name = encode(name);
    const encoded = encode(v);
    if (!token.test(name)) fail("COOKIE_NAME");
    return name + "=" + cookieValue(encoded);
  });
}
export function decodeModernCookie(parameter, header, options = {}) {
  const { style } = cookieConfig(parameter);
  if (
    typeof header !== "string" ||
    header.length > 65536 ||
    /[\r\n\x00]/.test(header)
  )
    fail("COOKIE_WIRE");
  const decode = (value) => {
    if (style === "cookie") return value;
    try {
      return decodeURIComponent(value);
    } catch {
      fail("COOKIE_PERCENT_ENCODING");
    }
  };
  const pairs = [];
  for (const part of header.split(/;[ \t]*/)) {
    if (!part) continue;
    const at = part.indexOf("=");
    if (at < 1 || !token.test(part.slice(0, at))) fail("COOKIE_WIRE");
    cookieValue(part.slice(at + 1));
    pairs.push([decode(part.slice(0, at)), decode(part.slice(at + 1))]);
  }
  if (pairs.length > 256) fail("COOKIE_PAIR_BUDGET");
  const schema = parameter.schema ?? true,
    s = mediaSchema(schema, undefined, options),
    t = wireType(s);
  const values = pairs
    .filter(([name]) => name === parameter.name)
    .map(([, value]) => value);
  if (parameter.content) {
    if (!values.length) return undefined;
    if (values.length !== 1) fail("COOKIE_DUPLICATE");
    const media =
        typeof parameter.content === "string"
          ? parameter.content
          : Object.keys(parameter.content)[0],
      content =
        typeof parameter.content === "string"
          ? (parameter.media_object ?? { schema: parameter.schema })
          : parameter.content[media];
    return decodeModernMedia(media, Buffer.from(values[0]), content, options);
  }
  if (
    !pairs.length ||
    (!values.length &&
      t !== "object" &&
      !(Array.isArray(s.type) && s.type.includes("object")) &&
      !s.oneOf &&
      !s.anyOf)
  )
    return undefined;
  const arrays = values.length
    ? combinations(
        values.map((value, i) => [
          i,
          modernWireCandidates(s.prefixItems?.[i] ?? s.items, value, options),
        ]),
        true,
      )
    : [];
  const objects =
    new Set(pairs.map(([name]) => name)).size === pairs.length
      ? combinations(
          pairs.map(([name, value]) => [
            name,
            modernWireCandidates(property(s, name), value, options),
          ]),
        )
      : [];
  const primitives =
    values.length === 1 ? modernWireCandidates(schema, values[0], options) : [];
  if (!options.validate && t === "object" && !objects.length)
    fail("COOKIE_DUPLICATE");
  if (
    !options.validate &&
    !["array", "object"].includes(t) &&
    values.length > 1
  )
    fail("COOKIE_DUPLICATE");
  return chooseModernWire(
    schema,
    t === "object"
      ? [...objects, ...primitives, ...arrays]
      : t === "array"
        ? [...arrays, ...primitives, ...objects]
        : [...primitives, ...arrays, ...objects],
    {
      ...options,
      wireCandidatesTruncated: arrays.truncated || objects.truncated,
    },
  );
}
function setCookieLines(value) {
  if (Array.isArray(value)) {
    if (!value.length || value.length > 256) fail("SET_COOKIE_LINE_BUDGET");
    if (value.some((v) => typeof v !== "string" || /[\r\n]/.test(v)))
      fail("SET_COOKIE_LINE");
    return value;
  }
  if (typeof value !== "string" || /\r(?!\n)/.test(value))
    fail("SET_COOKIE_LINE");
  const lines = value.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  if (!lines.length || lines.some((v) => !v)) fail("SET_COOKIE_LINE");
  return lines;
}
function validateSetCookieLine(line) {
  if (line.length > 16384 || /[\x00-\x08\x0a-\x1f\x7f]/.test(line))
    fail("SET_COOKIE_LINE");
  const at = line.indexOf("="),
    end = line.indexOf(";");
  if (at < 1 || (end >= 0 && at > end) || !token.test(line.slice(0, at)))
    fail("SET_COOKIE_NAME");
  cookieValue(line.slice(at + 1, end < 0 ? line.length : end));
  return line;
}
export function encodeSetCookieHeader(header, value, options = {}) {
  let lines;
  const media = Object.keys(header.content ?? {})[0];
  if (media)
    lines = setCookieLines(
      utf8(
        encodeModernMedia(media, value, header.content[media], options).body,
      ),
    );
  else if (Array.isArray(value)) lines = value.map(leaf);
  else if (value && typeof value === "object" && !numeric(value)) {
    if (header.explode !== true) fail("SET_COOKIE_OBJECT_REQUIRES_EXPLODE");
    lines = Object.entries(value).flatMap(([name, v]) =>
      (Array.isArray(v) ? v : [v]).map((item) => name + "=" + leaf(item)),
    );
  } else lines = setCookieLines(String(value));
  if (!lines.length || lines.length > 256) fail("SET_COOKIE_LINE_BUDGET");
  return lines.map(validateSetCookieLine);
}
export function decodeSetCookieHeader(header, wire, options = {}) {
  const lines = setCookieLines(wire).map(validateSetCookieLine);
  if (lines.length > 256) fail("SET_COOKIE_LINE_BUDGET");
  const media = Object.keys(header.content ?? {})[0];
  if (media)
    return decodeModernMedia(
      media,
      Buffer.from(lines.join("\n")),
      header.content[media],
      options,
    );
  const schema = header.schema ?? true,
    s = mediaSchema(schema, undefined, options),
    t = wireType(s),
    arrays = combinations(
      lines.map((line, i) => [
        i,
        modernWireCandidates(s.prefixItems?.[i] ?? s.items, line, options),
      ]),
      true,
    ),
    primitives = modernWireCandidates(schema, lines.join("\n"), options);
  let objects = [],
    nestedTruncated = false;
  if (header.explode === true) {
    const groups = new Map();
    for (const line of lines) {
      const at = line.indexOf("="),
        name = line.slice(0, at);
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(line.slice(at + 1));
    }
    const fields = [];
    for (const [name, values] of groups) {
      const ps = property(s, name),
        p = mediaSchema(ps, undefined, options),
        pt = wireType(p),
        list = combinations(
          values.map((value, i) => [
            i,
            modernWireCandidates(p.prefixItems?.[i] ?? p.items, value, options),
          ]),
          true,
        ),
        scalar =
          values.length === 1
            ? modernWireCandidates(ps, values[0], options)
            : [];
      nestedTruncated ||= list.truncated;
      const choices = (
        pt === "array" ? [...list, ...scalar] : [...scalar, ...list]
      ).filter((value) => !options.validate || validates(options, ps, value));
      fields.push([name, choices]);
    }
    objects = combinations(fields);
  } else if (t === "object" && !s.oneOf && !s.anyOf && !Array.isArray(s.type))
    fail("SET_COOKIE_OBJECT_REQUIRES_EXPLODE");
  if (!options.validate && t === "object" && !objects.length)
    fail("SET_COOKIE_DUPLICATE");
  return chooseModernWire(
    schema,
    t === "object"
      ? [...objects, ...primitives, ...arrays]
      : t === "array"
        ? [...arrays, ...primitives, ...objects]
        : [...primitives, ...arrays, ...objects],
    {
      ...options,
      wireCandidatesTruncated:
        arrays.truncated || objects.truncated || nestedTruncated,
    },
  );
}
class MultipartStreamParser {
  constructor(media, content, options) {
    const b = /(?:^|;)\s*boundary=(?:"([^"\r\n]+)"|([^;\s]+))/i.exec(media);
    this.boundary = b?.[1] ?? b?.[2];
    if (!validBoundary(this.boundary)) fail("MULTIPART_BOUNDARY");
    this.marker = Buffer.from("--" + this.boundary);
    this.delimiter = Buffer.from("\r\n--" + this.boundary);
    this.media = media;
    this.content = content;
    this.options = options;
    this.budget = checkBudget(options);
    this.buffer = Buffer.alloc(0);
    this.items = [];
    this.started = false;
    this.closed = false;
    this.shared = { parts: 0 };
    this.schema = mediaSchema(content.schema, undefined, options);
    this.positional =
      base(media) !== "multipart/form-data" ||
      wireType(this.schema) === "array" ||
      content.prefixEncoding !== undefined ||
      content.itemEncoding !== undefined;
    this.value = this.positional ? [] : {};
  }
  part(bytes) {
    if (
      bytes.length > this.budget.maxItemBytes ||
      this.items.length >= this.budget.maxItems
    )
      fail("SEQUENCE_RECORD_BUDGET");
    const index = this.items.length,
      schema =
        this.schema.prefixItems?.[index] ??
        this.schema.items ??
        this.content.itemSchema ??
        {},
      encoding =
        this.content.prefixEncoding?.[index] ??
        (index >= (this.content.prefixEncoding?.length ?? 0)
          ? this.content.itemEncoding
          : undefined) ??
        {};
    const content = this.positional
      ? {
          schema: { type: "array", prefixItems: [schema] },
          prefixEncoding: [encoding],
        }
      : this.content;
    const framed = Buffer.concat([
      this.marker,
      Buffer.from("\r\n"),
      bytes,
      Buffer.from("\r\n"),
      this.marker,
      Buffer.from("--\r\n"),
    ]);
    const parsed = decodeInner(this.media, framed, content, this.options, {
      depth: 0,
      path: "",
      shared: this.shared,
    });
    const item = this.positional ? parsed[0] : parsed;
    if (
      this.positional &&
      this.content.itemSchema !== undefined &&
      !validates(this.options, this.content.itemSchema, item)
    )
      fail("SEQUENCE_ITEM_SCHEMA");
    this.options.onItem?.(item, index);
    this.items.push(item);
    if (this.positional) this.value.push(item);
    else
      for (const [key, v] of Object.entries(parsed)) {
        if (!has(this.value, key)) setOwn(this.value, key, v);
        else {
          if (!Array.isArray(this.value[key]))
            setOwn(this.value, key, [this.value[key]]);
          this.value[key].push(...(Array.isArray(v) ? v : [v]));
        }
      }
  }
  feed(bytes, final = false) {
    if (this.closed) return; // MIME epilogue is not modeled as instance data.
    this.buffer = Buffer.concat([this.buffer, bytes]);
    for (;;) {
      if (!this.started) {
        const opening = openingBoundary(this.buffer, this.marker, final);
        if (!opening || opening.pending) break;
        if (opening.closing) {
          this.closed = true;
          this.buffer = Buffer.alloc(0);
          break;
        }
        this.buffer = this.buffer.subarray(opening.end);
        this.started = true;
      }
      let end = this.buffer.indexOf(this.delimiter);
      while (
        end >= 0 &&
        boundaryTail(this.buffer, end + this.delimiter.length, final) === false
      )
        end = this.buffer.indexOf(this.delimiter, end + this.delimiter.length);
      if (
        end < 0 ||
        boundaryTail(this.buffer, end + this.delimiter.length, final) ===
          undefined
      )
        break;
      this.part(this.buffer.subarray(0, end));
      this.buffer = this.buffer.subarray(end + 2);
      this.started = false;
    }
    if (
      this.buffer.length >
      this.budget.maxItemBytes + 16384 + this.marker.length
    )
      fail("SEQUENCE_RECORD_BUDGET");
    if (final && !this.closed) fail("MULTIPART_TRUNCATED");
  }
  finish() {
    if (!this.closed) fail("MULTIPART_TRUNCATED");
    if (
      this.content.schema !== undefined &&
      !validates(this.options, this.content.schema, this.value)
    )
      fail("MEDIA_SCHEMA");
    return { value: this.value, items: this.items, complete: true };
  }
}
export async function decodeModernStream(
  chunks,
  { media, content = {}, ...options } = {},
) {
  const multipart = base(media).startsWith("multipart/");
  if (
    (!sequenceMedia(media) && !multipart) ||
    typeof chunks?.[Symbol.asyncIterator] !== "function"
  )
    fail("STREAM_OPTIONS");
  const { maxBytes } = checkBudget(options),
    timeout = options.timeout ?? 2000;
  if (!Number.isInteger(timeout) || timeout < 10 || timeout > 30000)
    fail("STREAM_OPTIONS");
  const signal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(timeout)])
      : AbortSignal.timeout(timeout),
    parser = multipart
      ? new MultipartStreamParser(media, content, options)
      : new SequenceParser(media, content, options),
    decoder = multipart ? undefined : new TextDecoder("utf-8", { fatal: true }),
    iterator = chunks[Symbol.asyncIterator](),
    deadline = performance.now() + timeout;
  let total = 0,
    count = 0,
    completed = false;
  try {
    for (;;) {
      const next = await within(
        signal,
        () => iterator.next(),
        "MODERN_STREAM_DEADLINE",
      );
      if (next.done) {
        parser.feed(multipart ? Buffer.alloc(0) : decoder.decode(), true);
        completed = true;
        return { ...parser.finish(), bytes: total };
      }
      if (++count > 8192 || performance.now() >= deadline)
        fail("STREAM_CHUNK_BUDGET");
      if (!(next.value instanceof Uint8Array)) fail("STREAM_CHUNK");
      if ((total += next.value.length) > maxBytes) fail("MEDIA_BYTE_BUDGET");
      parser.feed(
        multipart ? next.value : decoder.decode(next.value, { stream: true }),
      );
      if (count % 64 === 0) await setImmediate();
    }
  } finally {
    if (!completed && iterator.return)
      Promise.resolve()
        .then(() => iterator.return())
        .catch(() => {});
  }
}

// Stateful byte-fed parser for the worker/HTTP backpressure bridge. A parsed
// prefix is never reported as complete; only explicit, successfully checked EOF
// can produce a complete result. Raw values stay private until that final call.
export function createModernStreamParser(media, content = {}, options = {}) {
  const multipart = base(media).startsWith("multipart/");
  if (
    (!sequenceMedia(media) && !multipart) ||
    !options ||
    typeof options !== "object" ||
    Array.isArray(options)
  )
    fail("STREAM_OPTIONS");
  assertModernMedia(media, content);
  const budget = checkBudget(options),
    timeout = options.timeout ?? 2000,
    maxChunks = options.maxChunks ?? 8192;
  if (
    !Number.isInteger(timeout) ||
    timeout < 10 ||
    timeout > 30000 ||
    !Number.isInteger(maxChunks) ||
    maxChunks < 1 ||
    maxChunks > 8192 ||
    (options.signal !== undefined && !(options.signal instanceof AbortSignal))
  )
    fail("STREAM_OPTIONS");
  const parser = multipart
    ? new MultipartStreamParser(media, content, options)
    : new SequenceParser(media, content, options);
  const decoder = multipart
      ? undefined
      : new TextDecoder("utf-8", { fatal: true }),
    deadline = performance.now() + timeout;
  let state = "open",
    bytes = 0,
    chunks = 0,
    itemCount = 0,
    failure = "";
  const erase = () => {
    itemCount = parser.items.length;
    parser.buffer = multipart ? Buffer.alloc(0) : "";
    parser.items = [];
    if ("value" in parser) parser.value = undefined;
    if ("data" in parser) parser.data = [];
  };
  const guard = () => {
    if (state !== "open") fail("STREAM_CLOSED");
    if (options.signal?.aborted) fail("STREAM_ABORTED");
    if (performance.now() >= deadline) fail("STREAM_DEADLINE");
  };
  const failed = (error) => {
    failure = /^MODERN_[A-Z0-9_]+$/.test(error?.message ?? "")
      ? error.message
      : "MODERN_STREAM_VALIDATION";
    state = "failed";
    erase();
    throw new Error(failure);
  };
  return {
    feed(chunk) {
      if (state !== "open") fail("STREAM_CLOSED");
      try {
        guard();
        if (!(chunk instanceof Uint8Array)) fail("STREAM_CHUNK");
        if (++chunks > maxChunks) fail("STREAM_CHUNK_BUDGET");
        if ((bytes += chunk.byteLength) > budget.maxBytes)
          fail("MEDIA_BYTE_BUDGET");
        let decoded;
        try {
          decoded = multipart ? chunk : decoder.decode(chunk, { stream: true });
        } catch {
          fail("STREAM_UTF8");
        }
        parser.feed(decoded, false);
        itemCount = parser.items.length;
        return { complete: false, bytes, chunks, item_count: itemCount };
      } catch (error) {
        return failed(error);
      }
    },
    finish() {
      if (state !== "open") fail("STREAM_CLOSED");
      try {
        guard();
        let tail;
        try {
          tail = multipart ? Buffer.alloc(0) : decoder.decode();
        } catch {
          fail("STREAM_UTF8");
        }
        parser.feed(tail, true);
        const result = parser.finish();
        state = "ended";
        erase();
        return {
          ...result,
          complete: true,
          bytes,
          chunks,
          item_count: itemCount,
        };
      } catch (error) {
        return failed(error);
      }
    },
    abort() {
      if (state === "open") {
        state = "aborted";
        erase();
      }
      return { aborted: state !== "ended" };
    },
    summary() {
      return {
        state,
        complete: state === "ended",
        bytes,
        chunks,
        item_count: itemCount,
        ...(failure ? { code: failure } : {}),
      };
    },
  };
}

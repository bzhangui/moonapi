import { randomBytes } from "node:crypto";
import {
  stringifyExact,
  parseExact,
  numeric,
  number,
  setOwn,
} from "./standard-value.mjs";
import { encodeXML, decodeXML } from "./standard-xml.mjs";
import { effective, validSchema } from "./standard-schema.mjs";
const type = (m) =>
  (m || "application/octet-stream").split(";")[0].trim().toLowerCase();
export function concreteMedia(m) {
  return m === "*/*"
    ? "application/json"
    : m.includes("*")
      ? m.replace("*", "plain")
      : m;
}
export function castWire(s, v) {
  if (v === "" && s?.nullable && !s.enum?.includes("")) return null;
  if (["number", "integer"].includes(s?.type)) {
    try {
      return number(v);
    } catch {
      return v;
    }
  }
  if (s?.type === "boolean" && ["true", "false"].includes(v))
    return v === "true";
  return v;
}
export function decodeHeader(s, value, explode = false) {
  if (s?.type === "array")
    return value.split(",").map((v) => decodeHeader(s.items, v.trim()));
  if (s?.type === "object") {
    const a = value.split(","),
      out = {};
    if (explode)
      for (const v of a) {
        const i = v.indexOf("=");
        if (i < 0) throw new Error("STANDARD_HEADER_VALUE");
        const k = v.slice(0, i).trim();
        setOwn(out, k, decodeHeader(property(s, k), v.slice(i + 1).trim()));
      }
    else {
      if (a.length % 2) throw new Error("STANDARD_HEADER_VALUE");
      for (let i = 0; i < a.length; i += 2) {
        const k = a[i].trim();
        setOwn(out, k, decodeHeader(property(s, k), a[i + 1].trim()));
      }
    }
    return out;
  }
  return castWire(s, value);
}
const leaf = (v) =>
  v === null
    ? ""
    : typeof v === "object" && !numeric(v)
      ? stringifyExact(v)
      : String(v);
const property = (s, k) =>
  Object.hasOwn(s.properties || {}, k)
    ? s.properties[k]
    : typeof s.additionalProperties === "object"
      ? s.additionalProperties
      : {};
const formToken = (v) => encodeURIComponent(leaf(v)).replace(/%20/g, "+");
function formPairs(name, value, e = {}) {
  const style = e.style || "form",
    explode = e.explode ?? style === "form",
    token = e.allowReserved
      ? (v) =>
          formToken(v).replace(
            /%(?:3A|2F|3F|40|21|24|27|28|29|2A|2C|3B)/gi,
            (c) => decodeURIComponent(c),
          )
      : formToken;
  if (
    style === "deepObject" &&
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    return Object.entries(value).map(
      ([k, v]) => `${token(name)}%5B${token(k)}%5D=${token(v)}`,
    );
  const vals = Array.isArray(value)
    ? value
    : value && typeof value === "object" && !numeric(value)
      ? Object.entries(value)
      : undefined;
  if (!vals) return [[name, value]];
  if (style === "form" && explode)
    return Array.isArray(value)
      ? value.map((v) => [name, v])
      : Object.entries(value);
  const sep =
    style === "spaceDelimited" ? " " : style === "pipeDelimited" ? "|" : ",";
  return [[name, vals.flat().map(leaf).join(sep)]];
}
function defaultType(s) {
  if (s?.type === "array") return defaultType(s.items);
  return s?.format === "binary" || s?.format === "byte"
    ? "application/octet-stream"
    : s?.type === "object" || s?.properties
      ? "application/json"
      : "text/plain";
}
function partType(e, s) {
  const choices = (e.contentType || defaultType(s))
    .split(",")
    .map((x) => x.trim());
  return concreteMedia(choices[0]);
}
const styled = (e) =>
  ["style", "explode", "allowReserved"].some((k) => Object.hasOwn(e, k));
export function encodeMedia(media, value, content = {}) {
  media = concreteMedia(media);
  const m = type(media),
    s = effective(content.schema, value);
  let body;
  if (m === "application/json" || m.endsWith("+json"))
    body = Buffer.from(stringifyExact(value));
  else if (m === "application/xml" || m === "text/xml" || m.endsWith("+xml"))
    body = Buffer.from(encodeXML(s, value));
  else if (m === "application/x-www-form-urlencoded") {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      numeric(value)
    )
      throw new Error("STANDARD_FORM_OBJECT_REQUIRED");
    const pairs = [];
    for (const [k, v] of Object.entries(value)) {
      const e = content.encoding?.[k] || {},
        p = property(s, k);
      if (!styled(e))
        pairs.push(
          `${formToken(k)}=${formToken(p?.format === "byte" ? v : p?.format === "binary" ? Buffer.from(String(v), "latin1").toString("base64") : Array.isArray(v) ? stringifyExact(v) : encodeMedia(partType(e, p), v, { schema: p }).body.toString("utf8"))}`,
        );
      else
        for (const pair of formPairs(k, v, e))
          pairs.push(
            typeof pair === "string"
              ? pair
              : `${formToken(pair[0])}=${(e.allowReserved ? (x) => formToken(x).replace(/%(?:3A|2F|3F|40|21|24|27|28|29|2A|2C|3B)/gi, (c) => decodeURIComponent(c)) : formToken)(pair[1])}`,
          );
    }
    body = Buffer.from(pairs.join("&"));
  } else if (m === "multipart/form-data") {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      numeric(value)
    )
      throw new Error("STANDARD_FORM_OBJECT_REQUIRED");
    const boundary = "moonapi-" + randomBytes(18).toString("hex"),
      chunks = [];
    for (const [k, v] of Object.entries(value)) {
      const e = content.encoding?.[k] || {},
        p = property(s, k);
      const pairs = Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]];
      for (const pair of pairs) {
        const [name, x] = typeof pair === "string" ? [k, pair] : pair;
        if (/[\r\n\x00]/.test(name)) throw new Error("STANDARD_PART_NAME");
        const ps = Array.isArray(v) ? p.items : p,
          mt = partType(e, ps);
        const part = encodeMedia(mt, x, { schema: ps });
        const dispositionHeader = Object.entries(e.headers || {}).find(
          ([k]) => k.toLowerCase() === "content-disposition",
        )?.[1];
        const disposition =
          dispositionHeader?.__wireValue ??
          dispositionHeader?.example ??
          `form-data; name="${name.replace(/["\\]/g, "\\$&")}"${["binary", "byte"].includes(ps?.format) ? '; filename="synthetic.bin"' : ""}`;
        const dn = /\bname="((?:\\.|[^"])*)"/.exec(String(disposition));
        if (
          /[\x00-\x1f\x7f]/.test(String(disposition)) ||
          !dn ||
          dn[1].replace(/\\(.)/g, "$1") !== name
        )
          throw new Error("STANDARD_PART_DISPOSITION");
        let h = `--${boundary}\r\nContent-Disposition: ${disposition}\r\nContent-Type: ${part.contentType}\r\n`;
        for (const [hn, hv] of Object.entries(e.headers || {})) {
          if (
            ["content-type", "content-disposition"].includes(hn.toLowerCase())
          )
            continue;
          const example =
            hv.__wireValue ??
            hv.example ??
            hv.schema?.example ??
            hv.schema?.default ??
            hv.schema?.enum?.[0];
          if (example === undefined) {
            if (hv.required)
              throw new Error("STANDARD_PART_HEADER_VALUE_REQUIRED");
            continue;
          }
          if (
            !/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(hn) ||
            /[\x00-\x1f\x7f]/.test(String(example))
          )
            throw new Error("STANDARD_PART_HEADER");
          h += `${hn}: ${leaf(example)}\r\n`;
        }
        chunks.push(Buffer.from(h + "\r\n"), part.body, Buffer.from("\r\n"));
      }
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    body = Buffer.concat(chunks);
    media += `; boundary=${boundary}`;
  } else
    body = Buffer.isBuffer(value)
      ? value
      : Buffer.from(
          typeof value === "string" ? value : leaf(value),
          s.format === "byte"
            ? "base64"
            : m === "application/octet-stream" || s.format === "binary"
              ? "latin1"
              : "utf8",
        );
  if (body.length > 1048576) throw new Error("STANDARD_MEDIA_BUDGET");
  return { body, contentType: media };
}
export function decodeMedia(media, raw, content = {}) {
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw),
    m = type(media),
    s = effective(content.schema);
  if (s.format === "byte" && !/json|xml/.test(m))
    return bytes.toString("base64");
  if (m === "application/octet-stream" || s.format === "binary")
    return bytes.toString("latin1");
  const text =
    m === "multipart/form-data"
      ? ""
      : new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (m === "application/json" || m.endsWith("+json")) return parseExact(text);
  if (m === "application/xml" || m === "text/xml" || m.endsWith("+xml"))
    return decodeXML(s, text);
  if (m === "application/x-www-form-urlencoded") {
    const params = new URLSearchParams(text),
      out = {},
      used = new Set();
    for (const [k, p] of Object.entries(s.properties || {})) {
      const e = content.encoding?.[k] || {};
      if (
        p.type === "object" &&
        (e.style === "deepObject" ||
          (styled(e) && (e.style ?? "form") === "form" && (e.explode ?? true)))
      ) {
        const v = {};
        for (const [name, x] of params) {
          const key =
            e.style === "deepObject"
              ? name.startsWith(k + "[") && name.endsWith("]")
                ? name.slice(k.length + 1, -1)
                : undefined
              : Object.hasOwn(p.properties || {}, name) &&
                  !Object.hasOwn(s.properties || {}, name)
                ? name
                : undefined;
          if (key !== undefined) {
            used.add(name);
            setOwn(v, key, castWire(property(p, key), x));
          }
        }
        if (Object.keys(v).length) setOwn(out, k, v);
      }
    }
    for (const k of new Set(params.keys())) {
      if (used.has(k)) continue;
      const p = property(s, k),
        e = content.encoding?.[k] || {},
        vals = params.getAll(k);
      if (!styled(e))
        setOwn(
          out,
          k,
          p?.format === "byte"
            ? vals[0]
            : p?.format === "binary"
              ? Buffer.from(vals[0], "base64").toString("latin1")
              : p.type === "array"
                ? parseExact(vals[0])
                : decodeMedia(partType(e, p), Buffer.from(vals[0]), {
                    schema: p,
                  }),
        );
      else if (p.type === "array")
        setOwn(
          out,
          k,
          (e.explode === false
            ? vals[0].split(
                e.style === "pipeDelimited"
                  ? "|"
                  : e.style === "spaceDelimited"
                    ? " "
                    : ",",
              )
            : vals
          ).map((v) => castWire(p.items, v)),
        );
      else if (p.type === "object" && e.explode === false) {
        const a = vals[0].split(","),
          v = {};
        for (let i = 0; i < a.length; i += 2)
          setOwn(v, a[i], castWire(p.properties?.[a[i]], a[i + 1]));
        setOwn(out, k, v);
      } else setOwn(out, k, castWire(p, vals[0]));
    }
    return out;
  }
  if (m === "multipart/form-data") {
    const boundary = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(media);
    if (!boundary || boundary[1]?.length > 200 || boundary[2]?.length > 200)
      throw new Error("STANDARD_MULTIPART_BOUNDARY");
    const delimiter = Buffer.from("--" + (boundary[1] || boundary[2])),
      out = {};
    let start = 0,
      count = 0,
      closed = false;
    while ((start = bytes.indexOf(delimiter, start)) >= 0) {
      start += delimiter.length;
      if (bytes.subarray(start, start + 2).toString() === "--") {
        closed = true;
        break;
      }
      const end = bytes.indexOf(
          Buffer.concat([Buffer.from("\r\n"), delimiter]),
          start,
        ),
        split = bytes.indexOf(Buffer.from("\r\n\r\n"), start);
      if (end < 0 || split < 0 || split > end || ++count > 256)
        throw new Error("STANDARD_MULTIPART_SYNTAX");
      const headers = {};
      for (const line of bytes
        .subarray(start + 2, split)
        .toString()
        .split("\r\n")) {
        const i = line.indexOf(":");
        if (i < 1) throw new Error("STANDARD_PART_HEADER");
        headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
      }
      const match = /\bname="((?:\\.|[^"])*)"/.exec(
        headers["content-disposition"] || "",
      );
      if (!match) throw new Error("STANDARD_PART_NAME");
      const k = match[1].replace(/\\(.)/g, "$1"),
        p = property(s, k),
        e = content.encoding?.[k] || {},
        ps = p.type === "array" ? p.items : p;
      if (
        e.contentType &&
        !e.contentType.split(",").some((x) => {
          const declared = type(x.trim()),
            actual = type(headers["content-type"] || defaultType(ps));
          return (
            declared === actual ||
            declared === "*/*" ||
            declared === actual.split("/")[0] + "/*"
          );
        })
      )
        throw new Error("STANDARD_PART_CONTENT_TYPE");
      for (const [h, v] of Object.entries(e.headers || {})) {
        if (h.toLowerCase() === "content-type") continue;
        const hv = headers[h.toLowerCase()];
        if (v.required && hv === undefined)
          throw new Error("STANDARD_PART_HEADER_REQUIRED");
        const hm = Object.keys(v.content || {})[0],
          rule = v.schema || v.content?.[hm]?.schema;
        if (
          hv !== undefined &&
          !validSchema(
            rule,
            hm
              ? decodeMedia(hm, Buffer.from(hv), v.content[hm])
              : decodeHeader(rule, hv, v.explode),
          )
        )
          throw new Error("STANDARD_PART_HEADER_SCHEMA");
      }
      const v = decodeMedia(
        headers["content-type"] || defaultType(ps),
        bytes.subarray(split + 4, end),
        { schema: ps },
      );
      if (p.type === "array") {
        if (!Object.hasOwn(out, k)) setOwn(out, k, []);
        out[k].push(v);
      } else {
        if (Object.hasOwn(out, k)) throw new Error("STANDARD_PART_DUPLICATE");
        setOwn(out, k, castWire(p, v));
      }
      start = end + 2;
    }
    if (!closed) throw new Error("STANDARD_MULTIPART_SYNTAX");
    return out;
  }
  return castWire(s, text);
}

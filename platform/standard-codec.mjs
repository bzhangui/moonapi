// OAS parameter serialization is not URLSearchParams(object): separators and
// percent-encoding must remain distinct. Values are always encoded separately.
import {
  stringifyExact,
  numeric,
  setOwn,
  parseExact,
} from "./standard-value.mjs";
import { encodeMedia, decodeMedia, castWire } from "./standard-media.mjs";
import {
  encodeModernMedia,
  decodeModernMedia,
  encodeQuerystring,
  decodeQuerystring,
  serializeModernCookie,
  decodeModernCookie,
  decodeModernHeader,
  mediaSchema,
  modernWireCandidates,
  modernWireCombinations,
  chooseModernWire,
} from "./modern-media.mjs";
const own = (v, k) => Object.hasOwn(v, k);
const scalar = (v) => (v === null ? "" : String(v));
const token = (v) =>
  encodeURIComponent(scalar(v)).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
function parts(value, encode = token) {
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === "object" && !numeric(value))
    return Object.entries(value).map(([k, v]) => [encode(k), encode(v)]);
  return encode(value);
}
export function serializeParameter(p, value, mediaOptions = {}) {
  if (p.modern && p.in === "querystring")
    return [
      encodeQuerystring(
        { in: p.in, name: p.name, content: p.contentDefinition ?? p.content },
        value,
        mediaOptions,
      ),
    ];
  if (p.modern && p.in === "cookie")
    return serializeModernCookie(
      { ...p, content: p.contentDefinition ?? p.content },
      value,
      mediaOptions,
    );
  const style =
    p.style ?? (["path", "header"].includes(p.in) ? "simple" : "form");
  const explode = p.explode ?? style === "form";
  const object =
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !numeric(value);
  const array = Array.isArray(value);
  if (
    !p.content &&
    ((array &&
      value.some((v) => v !== null && typeof v === "object" && !numeric(v))) ||
      (object &&
        Object.values(value).some(
          (v) => v !== null && typeof v === "object" && !numeric(v),
        )))
  )
    return serializeParameter(
      { ...p, content: "application/json", style: "form" },
      value,
    );
  const reserved = (v) =>
    token(v)
      .replace(
        p.modern
          ? /%(?:3A|2F|3F|40|21|24|27|28|29|2A|2B|2C|3B)/gi
          : /%(?:3A|2F|3F|40|21|24|27|28|29|2A|2C|3B)/gi,
        (c) => decodeURIComponent(c),
      )
      .replace(/%25([0-9A-F]{2})/gi, "%$1");
  const enc =
    p.in === "header"
      ? scalar
      : p.in === "query" && p.allowReserved
        ? reserved
        : p.in === "path" && style === "label"
          ? (v) => token(v).replace(/\./g, "%2E")
          : token;
  let v = parts(value, enc);
  const name = token(p.name);
  if (p.content) {
    const encoded = (p.in === "header" ? scalar : token)(
      (p.modern
        ? encodeModernMedia(
            p.content,
            value,
            p.contentDefinition?.[p.content] ?? { schema: p.schema },
            mediaOptions,
          )
        : encodeMedia(p.content, value, { schema: p.schema })
      ).body.toString("utf8"),
    );
    if (p.in !== "header")
      return p.in === "path" ? encoded : [`${name}=${encoded}`];
    v = encoded;
  }
  const joined = () =>
    object && !p.content
      ? v.map(([k, x]) => (explode ? `${k}=${x}` : `${k},${x}`)).join(",")
      : array && !p.content
        ? v.join(",")
        : v;
  if (p.in === "header") {
    const out = joined();
    if (
      /[\x00-\x1f\x7f]/.test(p.name + out) ||
      !/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(p.name)
    )
      throw new Error("STANDARD_HEADER_ENCODING");
    if (
      ["host", "connection", "transfer-encoding", "content-length"].includes(
        p.name.toLowerCase(),
      )
    )
      throw new Error("STANDARD_MANAGED_HEADER");
    return [p.name.toLowerCase(), out];
  }
  if (p.in === "path") {
    if (style === "simple") return joined();
    if (style === "label")
      return (
        "." +
        (object
          ? v
              .map(([k, x]) => (explode ? `${k}=${x}` : `${k},${x}`))
              .join(explode ? "." : ",")
          : array
            ? v.join(explode ? "." : ",")
            : v)
      );
    if (style === "matrix" && value === null) return `;${name}`;
    if (style === "matrix")
      return object && explode
        ? v.map(([k, x]) => `;${k}=${x}`).join("")
        : array && explode
          ? v.map((x) => `;${name}=${x}`).join("")
          : `;${name}=${joined()}`;
  }
  if (p.in === "query" || p.in === "cookie") {
    if (style === "deepObject" && object)
      return v.map(([k, x]) => `${name}%5B${k}%5D=${x}`);
    if (style === "form")
      return object && explode
        ? v.map(([k, x]) => `${k}=${x}`)
        : array && explode
          ? v.map((x) => `${name}=${x}`)
          : [`${name}=${joined()}`];
    if (
      ["spaceDelimited", "pipeDelimited"].includes(style) &&
      (array || object)
    )
      return [
        `${name}=${(object ? v.flat() : v).join(style === "spaceDelimited" ? "%20" : "%7C")}`,
      ];
  }
  throw new Error("STANDARD_PARAMETER_STYLE");
}
export function encodeRequest(operation, test, mediaOptions = {}) {
  let route = operation.path;
  const query = [],
    cookies = [],
    headers = { accept: "*/*" };
  for (const value of test.parameters) {
    const p = operation.parameters.find(
      (p) => p.name === value.name && p.in === value.in,
    );
    if (!p) throw new Error("STANDARD_UNKNOWN_PARAMETER");
    const encoded = serializeParameter(p, value.value, mediaOptions);
    if (p.in === "path") route = route.replaceAll("{" + p.name + "}", encoded);
    else if (p.in === "query" || p.in === "querystring") query.push(...encoded);
    else if (p.in === "cookie") cookies.push(...encoded);
    else headers[encoded[0]] = encoded[1];
  }
  if (cookies.length) headers.cookie = cookies.join("; ");
  if (
    /[{}\\?#\x00-\x20\x7f]/.test(route) ||
    !route.startsWith("/") ||
    route.startsWith("//") ||
    decodeURIComponent(route)
      .split("/")
      .some((v) => v === "." || v === "..")
  )
    throw new Error("STANDARD_UNSAFE_ROUTE");
  let body;
  if (own(test, "body")) {
    const media = test.media?.toLowerCase();
    const encoded = (operation.modern ? encodeModernMedia : encodeMedia)(
      media,
      test.body,
      operation.body_content?.[test.media] || {},
      mediaOptions,
    );
    body = encoded.body;
    headers["content-type"] = encoded.contentType;
    if (body?.byteLength > 262144) throw new Error("STANDARD_REQUEST_BUDGET");
  }
  return {
    route: route + (query.length ? "?" + query.join("&") : ""),
    headers,
    body,
  };
}
export function resolveServer(servers, selection = 0, variables = {}) {
  const server =
    typeof selection === "string"
      ? servers.find((s) => s.name === selection)
      : servers[selection];
  if (!server) throw new Error("STANDARD_SERVER_SELECTION");
  for (const key of Object.keys(variables))
    if (!own(server.variables ?? {}, key))
      throw new Error("STANDARD_UNKNOWN_SERVER_VARIABLE");
  return server.url.replace(/\{([^{}]+)\}/g, (_, key) => {
    const declaration = server.variables?.[key];
    const value = variables[key] ?? declaration?.default;
    if (
      typeof value !== "string" ||
      (declaration?.enum && !declaration.enum.includes(value)) ||
      /[\x00-\x20\x7f]/.test(value)
    )
      throw new Error("STANDARD_SERVER_VARIABLE");
    return value;
  });
}
export function deserializeParameter(p, wire, mediaOptions = {}) {
  if (p.modern && p.in === "querystring")
    return wire.query
      ? decodeQuerystring(
          { in: p.in, name: p.name, content: p.contentDefinition ?? p.content },
          wire.query.replace(/^\?/, ""),
          mediaOptions,
        )
      : undefined;
  if (p.modern) return deserializeModernParameter(p, wire, mediaOptions);
  const s = p.schema || {},
    style = p.style ?? (["path", "header"].includes(p.in) ? "simple" : "form"),
    explode = p.explode ?? style === "form";
  const qs = new URLSearchParams(wire.query || ""),
    cookies = new URLSearchParams(
      String(wire.headers?.cookie || "")
        .split(/;\s*/)
        .join("&"),
    );
  const collection = p.in === "cookie" ? cookies : qs;
  let raw =
    p.in === "header"
      ? wire.headers?.[p.name.toLowerCase()]
      : p.in === "path"
        ? wire.path?.[p.name]
        : collection.get(p.name);
  if (p.content)
    return raw == null
      ? undefined
      : p.modern
        ? decodeModernMedia(
            p.content,
            Buffer.from(raw),
            p.contentDefinition?.[p.content] ?? { schema: s },
            mediaOptions,
          )
        : decodeMedia(p.content, Buffer.from(raw), { schema: s });
  if (
    s.type === "object" &&
    ["query", "cookie"].includes(p.in) &&
    (style === "deepObject" || (style === "form" && explode))
  ) {
    const out = {};
    for (const [k, v] of collection) {
      const name =
        style === "deepObject"
          ? k.startsWith(p.name + "[") && k.endsWith("]")
            ? k.slice(p.name.length + 1, -1)
            : undefined
          : Object.hasOwn(s.properties || {}, k)
            ? k
            : undefined;
      if (name !== undefined)
        setOwn(out, name, castWire(s.properties?.[name], v));
    }
    return Object.keys(out).length ? out : undefined;
  }
  if (raw == null) return undefined;
  let tokens;
  if (p.in === "path") {
    if (style === "label") raw = raw.replace(/^\./, "");
    if (style === "matrix") {
      tokens = raw.replace(/^;/, "").split(";");
      if (!tokens[0].includes("=") && s.nullable) return null;
      if (!explode) {
        raw = tokens[0].includes("=")
          ? tokens[0].slice(tokens[0].indexOf("=") + 1)
          : "";
        tokens = undefined;
      } else if (s.type === "array")
        tokens = tokens.map((x) => x.slice(x.indexOf("=") + 1));
    }
    if (raw === "" && s.nullable) return null;
    if (s.type !== "array" && s.type !== "object")
      return castWire(
        s,
        decodeURIComponent(
          style === "matrix" && explode
            ? tokens[0].slice(tokens[0].indexOf("=") + 1)
            : raw,
        ),
      );
  }
  if (s.type === "array") {
    if (raw === "") return s.nullable ? null : [];
    tokens ??=
      ["query", "cookie"].includes(p.in) && style === "form" && explode
        ? collection.getAll(p.name)
        : raw.split(
            style === "spaceDelimited"
              ? " "
              : style === "pipeDelimited"
                ? "|"
                : style === "label" && explode
                  ? "."
                  : ",",
          );
    return tokens.map((x) =>
      castWire(s.items, p.in === "path" ? decodeURIComponent(x) : x),
    );
  }
  if (s.type === "object") {
    if (raw === "") return s.nullable ? null : {};
    tokens ??= raw.split(
      style === "spaceDelimited"
        ? " "
        : style === "pipeDelimited"
          ? "|"
          : style === "label" && explode
            ? "."
            : ",",
    );
    const out = {};
    if (explode)
      for (const t of tokens) {
        const i = t.indexOf("=");
        if (i < 0) throw new Error("STANDARD_PARAMETER_OBJECT");
        const key =
          p.in === "path" ? decodeURIComponent(t.slice(0, i)) : t.slice(0, i);
        setOwn(
          out,
          key,
          castWire(
            s.properties?.[key],
            p.in === "path"
              ? decodeURIComponent(t.slice(i + 1))
              : t.slice(i + 1),
          ),
        );
      }
    else {
      if (tokens.length % 2) throw new Error("STANDARD_PARAMETER_OBJECT");
      for (let i = 0; i < tokens.length; i += 2) {
        const key = p.in === "path" ? decodeURIComponent(tokens[i]) : tokens[i];
        setOwn(
          out,
          key,
          castWire(
            s.properties?.[key],
            p.in === "path" ? decodeURIComponent(tokens[i + 1]) : tokens[i + 1],
          ),
        );
      }
    }
    return out;
  }
  return castWire(s, raw);
}
function deserializeModernParameter(p, wire, options) {
  if (p.in === "cookie")
    return decodeModernCookie(
      { ...p, content: p.contentDefinition ?? p.content },
      String(wire.headers?.cookie ?? ""),
      options,
    );
  if (p.in === "header")
    return decodeModernHeader(p, wire.headers?.[p.name.toLowerCase()], options);
  const schema = p.schema ?? true,
    s = mediaSchema(schema, undefined, options),
    types = Array.isArray(s.type) ? s.type : [s.type],
    style = p.style ?? (p.in === "path" ? "simple" : "form"),
    explode = p.explode ?? style === "form";
  const decode = (value) => {
    try {
      return decodeURIComponent(value);
    } catch {
      throw new Error("MODERN_PARAMETER_PERCENT_ENCODING");
    }
  };
  const child = (key) =>
    own(s.properties ?? {}, key)
      ? s.properties[key]
      : typeof s.additionalProperties === "object"
        ? s.additionalProperties
        : true;
  const pairs = String(wire.query ?? "")
    .replace(/^\?/, "")
    .split("&")
    .filter(Boolean)
    .map((part) => {
      const i = part.indexOf("=");
      return [
        decode(i < 0 ? part : part.slice(0, i)),
        i < 0 ? "" : part.slice(i + 1),
      ];
    });
  if (pairs.length > 256) throw new Error("MODERN_PARAMETER_BUDGET");
  const named = pairs
    .filter(([name]) => name === p.name)
    .map(([, value]) => value);
  let raw = p.in === "path" ? wire.path?.[p.name] : named[0],
    arrayTokens,
    objectPairs,
    bareNull = false;
  if (
    p.in === "query" &&
    (style === "deepObject" || (style === "form" && explode))
  ) {
    objectPairs = [];
    for (const [name, value] of pairs) {
      const key =
        style === "deepObject"
          ? name.startsWith(p.name + "[") && name.endsWith("]")
            ? name.slice(p.name.length + 1, -1)
            : undefined
          : own(s.properties ?? {}, name) ||
              (!Object.keys(s.properties ?? {}).length &&
                s.additionalProperties !== false)
            ? name
            : undefined;
      if (key !== undefined) objectPairs.push([key, value]);
    }
  }
  if (raw === undefined && !objectPairs?.length) return undefined;
  if (p.content) {
    if (raw === undefined || (p.in === "query" && named.length !== 1))
      return undefined;
    return decodeModernMedia(
      p.content,
      Buffer.from(decode(raw)),
      p.contentDefinition?.[p.content] ?? { schema },
      options,
    );
  }
  if (p.in === "path") {
    if (typeof raw !== "string") throw new Error("MODERN_PARAMETER_WIRE");
    if (style === "label") {
      if (!raw.startsWith(".")) throw new Error("MODERN_PARAMETER_LABEL");
      raw = raw.slice(1);
    } else if (style === "matrix") {
      if (!raw.startsWith(";")) throw new Error("MODERN_PARAMETER_MATRIX");
      const entries = raw
        .slice(1)
        .split(";")
        .map((v) => {
          const i = v.indexOf("=");
          return [
            decode(i < 0 ? v : v.slice(0, i)),
            i < 0 ? undefined : v.slice(i + 1),
          ];
        });
      if (entries.length > 256) throw new Error("MODERN_PARAMETER_BUDGET");
      if (explode) {
        arrayTokens = entries
          .filter(([name]) => name === p.name)
          .map(([, value]) => value ?? "");
        objectPairs = entries.map(([key, value]) => [key, value ?? ""]);
      }
      const selected = entries.find(([name]) => name === p.name);
      if (selected) {
        bareNull = selected[1] === undefined;
        raw = selected[1] ?? "";
      } else raw = undefined;
    }
  }
  const separator =
    style === "label" && explode
      ? "."
      : style === "pipeDelimited"
        ? /\||%7c/gi
        : style === "spaceDelimited"
          ? / |%20|\+/gi
          : ",";
  arrayTokens ??=
    p.in === "query" && style === "form" && explode
      ? named
      : raw === undefined
        ? []
        : raw.split(separator);
  if (arrayTokens.length > 256) throw new Error("MODERN_PARAMETER_BUDGET");
  const arrays = modernWireCombinations(
    arrayTokens.map((v, i) => [
      i,
      modernWireCandidates(s.prefixItems?.[i] ?? s.items, decode(v), options),
    ]),
    true,
  );
  if (raw === "") arrays.unshift([]);
  if (!objectPairs && raw !== undefined) {
    const pieces = raw.split(separator);
    if (explode)
      objectPairs = pieces.every((v) => v.includes("="))
        ? pieces.map((v) => {
            const at = v.indexOf("=");
            return [decode(v.slice(0, at)), v.slice(at + 1)];
          })
        : undefined;
    else if (pieces.length % 2 === 0) {
      objectPairs = [];
      for (let i = 0; i < pieces.length; i += 2)
        objectPairs.push([decode(pieces[i]), pieces[i + 1]]);
    }
  }
  let objects = [];
  if (objectPairs) {
    if (objectPairs.length > 256) throw new Error("MODERN_PARAMETER_BUDGET");
    if (new Set(objectPairs.map(([key]) => key)).size === objectPairs.length)
      objects = modernWireCombinations(
        objectPairs.map(([key, value]) => [
          key,
          modernWireCandidates(child(key), decode(value), options),
        ]),
      );
  }
  if (raw === "") objects.unshift({});
  const primitives =
    raw === undefined || (p.in === "query" && named.length > 1)
      ? []
      : bareNull
        ? [null]
        : modernWireCandidates(schema, decode(raw), options);
  // Nested RFC6570 objects have no standard representation. Retain the existing
  // explicit JSON fallback symmetrically; ordinary scalar CSV is not JSON-cast.
  if (
    raw !== undefined &&
    ((s.items &&
      typeof s.items === "object" &&
      ["object", "array"].includes(s.items.type)) ||
      Object.values(s.properties ?? {}).some((v) =>
        ["object", "array"].includes(v.type),
      ))
  ) {
    try {
      const value = parseExact(decode(raw));
      if (value && typeof value === "object" && !numeric(value))
        primitives.unshift(value);
    } catch {}
  }
  return chooseModernWire(
    schema,
    types.includes("array")
      ? [...arrays, ...primitives, ...objects]
      : types.includes("object")
        ? [...objects, ...primitives, ...arrays]
        : [...primitives, ...arrays, ...objects],
    {
      ...options,
      wireCandidatesTruncated: arrays.truncated || objects.truncated,
    },
  );
}

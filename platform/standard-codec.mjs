// OAS parameter serialization is not URLSearchParams(object): separators and
// percent-encoding must remain distinct. Values are always encoded separately.
const own = (v, k) => Object.hasOwn(v, k);
const scalar = (v) => (v === null ? "" : String(v));
const token = (v) =>
  encodeURIComponent(scalar(v)).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
function parts(value, encode = token) {
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === "object")
    return Object.entries(value).map(([k, v]) => [encode(k), encode(v)]);
  return encode(value);
}
export function serializeParameter(p, value) {
  const style =
    p.style ?? (["path", "header"].includes(p.in) ? "simple" : "form");
  const explode = p.explode ?? style === "form";
  const object =
    value !== null && typeof value === "object" && !Array.isArray(value);
  const array = Array.isArray(value);
  if (
    (array && value.some((v) => v !== null && typeof v === "object")) ||
    (object &&
      Object.values(value).some((v) => v !== null && typeof v === "object"))
  )
    throw new Error("STANDARD_NESTED_PARAMETER_SERIALIZATION");
  const enc = p.in === "header" ? scalar : token;
  let v = parts(value, enc);
  const name = token(p.name);
  if (p.content)
    v = (p.in === "header" ? scalar : token)(
      p.content.includes("json") ? JSON.stringify(value) : scalar(value),
    );
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
    if (style === "matrix")
      return object && explode
        ? v.map(([k, x]) => `;${k}=${x}`).join("")
        : array && explode
          ? v.map((x) => `;${name}=${x}`).join("")
          : `;${name}=${joined()}`;
  }
  if (p.in === "query" || p.in === "cookie") {
    if (p.allowReserved && /[&=#?\[\]]/.test(JSON.stringify(value)))
      throw new Error("STANDARD_RESERVED_DELIMITER_PENDING");
    if (p.allowReserved) {
      const unescape = (s) =>
        s.replace(/%(?:3A|2F|40|21|24|27|28|29|2A|2B|2C|3B)/gi, (c) =>
          decodeURIComponent(c),
        );
      v = array
        ? v.map(unescape)
        : object
          ? v.map((pair) => pair.map(unescape))
          : unescape(v);
    }
    if (style === "deepObject" && object)
      return v.map(([k, x]) => `${name}[${k}]=${x}`);
    if (style === "form")
      return object && explode
        ? v.map(([k, x]) => `${k}=${x}`)
        : array && explode
          ? v.map((x) => `${name}=${x}`)
          : [`${name}=${joined()}`];
    if (
      ["spaceDelimited", "pipeDelimited"].includes(style) &&
      array &&
      !explode
    )
      return [`${name}=${v.join(style === "spaceDelimited" ? "%20" : "|")}`];
  }
  throw new Error("STANDARD_PARAMETER_STYLE_PENDING");
}
export function encodeRequest(operation, test) {
  let route = operation.path;
  const query = [],
    cookies = [],
    headers = { accept: "*/*" };
  for (const value of test.parameters) {
    const p = operation.parameters.find(
      (p) => p.name === value.name && p.in === value.in,
    );
    if (!p) throw new Error("STANDARD_UNKNOWN_PARAMETER");
    const encoded = serializeParameter(p, value.value);
    if (p.in === "path") route = route.replaceAll("{" + p.name + "}", encoded);
    else if (p.in === "query") query.push(...encoded);
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
    if (!media || /xml|\*/.test(media))
      throw new Error("STANDARD_MEDIA_ENCODING_PENDING");
    headers["content-type"] = test.media;
    if (media === "application/json" || media.endsWith("+json"))
      body = JSON.stringify(test.body);
    else if (media === "application/x-www-form-urlencoded") {
      if (
        !test.body ||
        typeof test.body !== "object" ||
        Array.isArray(test.body)
      )
        throw new Error("STANDARD_FORM_OBJECT_REQUIRED");
      body = Object.entries(test.body)
        .flatMap(([name, value]) =>
          serializeParameter(
            { name, in: "query", style: "form", explode: true },
            value,
          ),
        )
        .join("&");
    } else if (media === "multipart/form-data") {
      if (
        !test.body ||
        typeof test.body !== "object" ||
        Array.isArray(test.body)
      )
        throw new Error("STANDARD_FORM_OBJECT_REQUIRED");
      body = new FormData();
      for (const [name, value] of Object.entries(test.body)) {
        for (const item of Array.isArray(value) ? value : [value])
          body.append(
            name,
            operation.binary_fields?.[test.media]?.includes(name)
              ? new Blob([Buffer.from(scalar(item), "latin1")], {
                  type: "application/octet-stream",
                })
              : typeof item === "object"
                ? new Blob([JSON.stringify(item)], { type: "application/json" })
                : scalar(item),
          );
      }
      delete headers["content-type"]; // fetch supplies its own boundary.
    } else if (
      media === "application/octet-stream" &&
      typeof test.body === "string"
    )
      body = Buffer.from(test.body, "latin1");
    else if (typeof test.body === "string") body = test.body;
    else throw new Error("STANDARD_MEDIA_ENCODING_PENDING");
    if (typeof body === "string" && Buffer.byteLength(body) > 262144)
      throw new Error("STANDARD_REQUEST_BUDGET");
    if (
      body instanceof FormData &&
      Buffer.byteLength(JSON.stringify(test.body)) > 262144
    )
      throw new Error("STANDARD_REQUEST_BUDGET");
  }
  return {
    route: route + (query.length ? "?" + query.join("&") : ""),
    headers,
    body,
  };
}
export function resolveServer(servers, selection = 0, variables = {}) {
  const server = servers[selection];
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

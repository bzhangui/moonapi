import {
  setOwn,
  cloneExact,
  numeric,
  stringifyExact,
} from "./standard-value.mjs";
export function pointer(value, fragment) {
  if (fragment === "") return value;
  if (!fragment.startsWith("/")) throw new Error("STANDARD_RUNTIME_POINTER");
  for (const raw of fragment.slice(1).split("/")) {
    if (/~(?![01])/u.test(raw)) throw new Error("STANDARD_RUNTIME_POINTER");
    const k = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!value || typeof value !== "object" || !Object.hasOwn(value, k))
      return undefined;
    value = value[k];
  }
  return value;
}
const runtimeSyntax =
  /^\$(?:url|method|statusCode|(?:request|response)\.(?:header\.[!#$%&'*+.^_`|~0-9A-Za-z-]+|query\.[\s\S]*|path\.[\s\S]*|body(?:#(?:\/(?:[^~\/]|~[01])*)*)?))$/u;
export function runtimeValue(value, context) {
  return typeof value !== "string"
    ? cloneExact(value)
    : runtimeSyntax.test(value) || value.includes("{$")
      ? expression(value, context)
      : value;
}
export function parseExpression(expr) {
  if (typeof globalThis.__moonapi_core === "function") {
    const result = JSON.parse(
      globalThis.__moonapi_core(
        JSON.stringify({ action: "standard-expression", expression: expr }),
      ),
    );
    if (!result.ok) throw new Error("STANDARD_RUNTIME_EXPRESSION");
    return result.value;
  }
  if (expr.length > 8192) throw new Error("STANDARD_RUNTIME_EXPRESSION");
  if (["$url", "$method", "$statusCode"].includes(expr))
    return { kind: "meta", key: expr.slice(1) };
  const m =
    /^\$(request|response)\.(body(?:#([\s\S]*))?|header\.(.*)|query\.([\s\S]*)|path\.([\s\S]*))$/.exec(
      expr,
    );
  if (!m) throw new Error("STANDARD_RUNTIME_EXPRESSION");
  if (m[2].startsWith("body")) {
    const p = m[3] ?? "";
    if ((p !== "" && !p.startsWith("/")) || /~(?![01])/u.test(p))
      throw new Error("STANDARD_RUNTIME_EXPRESSION");
    return { kind: "body", source: m[1], pointer: p };
  }
  const kind =
      m[4] !== undefined ? "header" : m[5] !== undefined ? "query" : "path",
    key = m[4] ?? m[5] ?? m[6];
  if (kind === "header" && !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key))
    throw new Error("STANDARD_RUNTIME_EXPRESSION");
  return { kind, source: m[1], key };
}
export function expression(expr, context) {
  if (typeof expr !== "string") return cloneExact(expr);
  if (!expr.startsWith("$") && expr.includes("{")) {
    let missing = false;
    const result = expr.replace(/\{(\$[^{}]+)\}/g, (_, x) => {
      if (!runtimeSyntax.test(x)) return "{" + x + "}";
      const v = expression(x, context);
      if (v === undefined) missing = true;
      return v === undefined
        ? ""
        : typeof v === "object" && !numeric(v)
          ? stringifyExact(v)
          : String(v);
    });
    return missing ? undefined : result;
  }
  if (!expr.startsWith("$")) return expr;
  const ast = parseExpression(expr);
  if (ast.kind === "meta")
    return ast.key === "statusCode"
      ? context.status === undefined
        ? undefined
        : String(context.status)
      : context[ast.key];
  const data = context[ast.source] || {};
  if (ast.kind === "body") return pointer(data.body, ast.pointer);
  if (ast.kind === "header")
    return Object.entries(data.header || {}).find(
      ([k]) => k.toLowerCase() === ast.key.toLowerCase(),
    )?.[1];
  return data[ast.kind]?.[ast.key];
}
export function bindExpression(test, expr, value) {
  // Bind only caller-owned request inputs. Response-derived expressions cannot
  // be rewritten before a request; callers can instead supply an explicit URL.
  if (typeof expr !== "string") return false;
  // Strip only a complete expression envelope, never a literal trailing brace
  // in an unwrapped JSON Pointer or parameter name. Parsing/binding must agree.
  const source =
    expr.startsWith("{") && expr.endsWith("}") ? expr.slice(1, -1) : expr;
  let ast;
  try {
    ast = parseExpression(source);
  } catch {
    return false;
  }
  if (ast.source !== "request") return false;
  if (ast.kind === "body") {
    const fragment = ast.pointer;
    if (!fragment) {
      test.body = value;
      return true;
    }
    const keys = fragment
      .slice(1)
      .split("/")
      .map((k) => k.replace(/~1/g, "/").replace(/~0/g, "~"));
    let parent = test.body;
    if (!parent || typeof parent !== "object") return false;
    for (const k of keys.slice(0, -1)) {
      if (
        !Object.hasOwn(parent, k) ||
        !parent[k] ||
        typeof parent[k] !== "object"
      )
        setOwn(parent, k, {});
      parent = parent[k];
    }
    setOwn(parent, keys.at(-1), value);
    return true;
  }
  const location = ast.kind,
    name = ast.key;
  const p = test.parameters.find(
    (p) =>
      p.in === location &&
      (location === "header"
        ? p.name.toLowerCase() === name.toLowerCase()
        : p.name === name),
  );
  if (p) p.value = value;
  else test.parameters.push({ in: location, name, value });
  return true;
}
export function requestContext(test, headers = {}, url) {
  const result = { body: test.body, header: {}, query: {}, path: {} };
  if (url)
    for (const [k, v] of new URL(url).searchParams) setOwn(result.query, k, v);
  for (const p of test.parameters) {
    if (p.in === "querystring") {
      result.querystring = cloneExact(p.value);
      continue;
    }
    if (p.in !== "cookie") setOwn(result[p.in], p.name, p.value);
  }
  // Only declared request header parameters are addressable by expressions.
  for (const k of Object.keys(result.header))
    result.header[k] = headers[k.toLowerCase()] ?? result.header[k];
  return result;
}

import { equal, numeric, shadow, decimal, compare } from "./standard-value.mjs";
import { validSchema, effective } from "./standard-schema.mjs";
const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};
const methods = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
];
const maps = new Set([
  "headers",
  "content",
  "links",
  "securitySchemes",
  "responses",
  "requestBodies",
  "parameters",
  "callbacks",
]);
// JSON Reference parsers otherwise mistake literal business '$ref' data inside
// examples/defaults/extensions for documents to load. A private per-worker key
// shields only those opaque values during bundling and is restored afterwards.
export function shieldLiterals(root, key, restore = false) {
  const seen = new Set();
  const data = (v) => {
    if (!v || typeof v !== "object" || seen.has(v)) return;
    seen.add(v);
    const from = restore ? key : "$ref",
      to = restore ? "$ref" : key;
    if (Object.hasOwn(v, from)) {
      Object.defineProperty(v, to, {
        value: v[from],
        enumerable: true,
        writable: true,
        configurable: true,
      });
      delete v[from];
    }
    for (const x of Object.values(v)) data(x);
  };
  const walk = (v, kind = "oas") => {
    if (!v || typeof v !== "object" || seen.has(v)) return;
    if (restore) {
      data(v);
      return;
    }
    seen.add(v);
    if (kind === "schema") {
      for (const k of ["example", "default", "enum"]) data(v[k]);
      for (const p of Object.values(v.properties || {})) walk(p, "schema");
      for (const k of ["items", "not", "additionalProperties"])
        walk(v[k], "schema");
      for (const k of ["allOf", "oneOf", "anyOf"])
        for (const s of v[k] || []) walk(s, "schema");
      for (const [k, x] of Object.entries(v)) if (k.startsWith("x-")) data(x);
      return;
    }
    for (const [k, x] of Object.entries(v)) {
      if (
        k.startsWith("x-") ||
        k === "example" ||
        k === "default" ||
        (kind === "example" && k === "value")
      ) {
        data(x);
        continue;
      }
      if (k === "schemas" || k === "examples" || maps.has(k))
        for (const p of Object.values(x || {}))
          walk(
            p,
            k === "schemas" ? "schema" : k === "examples" ? "example" : "oas",
          );
      else walk(x, k === "schema" ? "schema" : "oas");
    }
  };
  walk(root);
  return root;
}
export function stripRefSiblings(root) {
  const seen = new Set();
  const walk = (v, kind = "oas") => {
    if (!v || typeof v !== "object" || seen.has(v)) return;
    seen.add(v);
    if (kind !== "path" && typeof v.$ref === "string") {
      for (const k of Object.keys(v)) if (k !== "$ref") delete v[k];
      return;
    }
    if (kind === "schema") {
      for (const p of Object.values(v.properties || {})) walk(p, "schema");
      for (const k of ["items", "not", "additionalProperties"])
        walk(v[k], "schema");
      for (const k of ["allOf", "oneOf", "anyOf"])
        for (const p of v[k] || []) walk(p, "schema");
      return;
    }
    if (kind === "callback") {
      for (const [k, x] of Object.entries(v))
        if (!k.startsWith("x-")) walk(x, "path");
      return;
    }
    for (const [k, x] of Object.entries(v)) {
      if (
        k.startsWith("x-") ||
        ["example", "default", "enum"].includes(k) ||
        (kind === "example" && k === "value")
      )
        continue;
      const target =
        k === "schemas"
          ? "schema"
          : k === "paths"
            ? "path"
            : k === "callbacks"
              ? "callback"
              : k === "examples"
                ? "example"
                : undefined;
      if ((target || maps.has(k)) && x && typeof x === "object")
        for (const child of Object.values(x)) walk(child, target || "oas");
      else walk(x, k === "schema" ? "schema" : "oas");
    }
  };
  walk(root);
  return root;
}
// Semantic traversal visits OAS objects, never arbitrary business/example keys.
export function auditDocument(api) {
  const seen = new Set(),
    ids = new Set(),
    links = [];
  const servers = (list) => {
    for (const server of list || [])
      for (const match of server.url.matchAll(/\{([^{}]+)\}/g))
        if (!Object.hasOwn(server.variables || {}, match[1]))
          fail("STANDARD_SERVER_VARIABLE");
  };
  const schema = (s) => {
    if (!s || seen.has(s)) return;
    seen.add(s);
    if (
      s.enum &&
      s.enum.some((v, i) => s.enum.slice(0, i).some((w) => equal(v, w)))
    )
      fail("STANDARD_ENUM_DUPLICATE");
    if (s.readOnly && s.writeOnly) fail("STANDARD_SCHEMA_DIRECTION");
    for (const key of [
      "minLength",
      "maxLength",
      "minItems",
      "maxItems",
      "minProperties",
      "maxProperties",
    ])
      if (
        Object.hasOwn(s, key) &&
        (!numeric(s[key]) || decimal(s[key])[1] < 0 || compare(s[key], 0) < 0)
      )
        fail("STANDARD_SCHEMA_COUNT");
    if (
      Object.hasOwn(s, "multipleOf") &&
      (!numeric(s.multipleOf) || compare(s.multipleOf, 0) <= 0)
    )
      fail("STANDARD_SCHEMA_MULTIPLE");
    if (s.pattern)
      try {
        new RegExp(s.pattern);
      } catch {
        fail("STANDARD_SCHEMA_PATTERN");
      }
    if (s.xml?.namespace && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(s.xml.namespace))
      fail("STANDARD_XML_NAMESPACE");
    if (
      Object.hasOwn(s, "default") &&
      s.type &&
      !validSchema({ type: s.type, nullable: s.nullable }, s.default)
    )
      fail("STANDARD_SCHEMA_DEFAULT_TYPE");
    for (const p of Object.values(s.properties || {})) schema(p);
    for (const k of ["items", "not", "additionalProperties"])
      if (typeof s[k] === "object") schema(s[k]);
    for (const k of ["allOf", "oneOf", "anyOf"])
      for (const p of s[k] || []) schema(p);
  };
  const content = (c) => {
    for (const m of Object.values(c || {})) {
      schema(m.schema);
      for (const [name, e] of Object.entries(m.encoding || {})) {
        if (!Object.hasOwn(effective(m.schema).properties, name))
          fail("STANDARD_ENCODING_PROPERTY");
        for (const h of Object.values(e.headers || {})) parameter(h);
      }
    }
  };
  const parameter = (p) => {
    if (!p) return;
    schema(p.schema);
    content(p.content);
    if (p.schema && p.content) fail("STANDARD_PARAMETER_SCHEMA_CONTENT");
    const styles = {
      path: ["simple", "label", "matrix"],
      query: ["form", "spaceDelimited", "pipeDelimited", "deepObject"],
      header: ["simple"],
      cookie: ["form"],
    };
    if (p.in && p.style && !styles[p.in]?.includes(p.style))
      fail("STANDARD_PARAMETER_STYLE");
  };
  const response = (r) => {
    content(r.content);
    for (const h of Object.values(r.headers || {})) parameter(h);
    links.push(...Object.values(r.links || {}));
  };
  const security = (list) => {
    for (const requirement of list || [])
      for (const [name, scopes] of Object.entries(requirement)) {
        const s = api.components?.securitySchemes?.[name];
        if (
          !s ||
          (!["oauth2", "openIdConnect"].includes(s.type) && scopes.length)
        )
          fail("STANDARD_SECURITY_REQUIREMENT");
        if (s.type === "oauth2") {
          const known = new Set(
            Object.values(s.flows).flatMap((f) => Object.keys(f.scopes)),
          );
          if (scopes.some((scope) => !known.has(scope)))
            fail("STANDARD_SECURITY_SCOPE");
        }
      }
  };
  const path = (item) => {
    if (seen.has(item)) return;
    seen.add(item);
    servers(item.servers);
    for (const list of [item.parameters || []]) {
      const names = new Set();
      for (const p of list) {
        const key =
          p.in + ":" + (p.in === "header" ? p.name.toLowerCase() : p.name);
        if (names.has(key)) fail("STANDARD_DUPLICATE_PARAMETER");
        names.add(key);
        parameter(p);
      }
    }
    for (const method of methods)
      if (item[method]) {
        const o = item[method];
        servers(o.servers);
        security(o.security);
        if (o.operationId) {
          if (ids.has(o.operationId)) fail("STANDARD_DUPLICATE_OPERATION");
          ids.add(o.operationId);
        }
        const names = new Set();
        for (const p of o.parameters || []) {
          const key =
            p.in + ":" + (p.in === "header" ? p.name.toLowerCase() : p.name);
          if (names.has(key)) fail("STANDARD_DUPLICATE_PARAMETER");
          names.add(key);
          parameter(p);
        }
        content(o.requestBody?.content);
        for (const r of Object.values(o.responses || {})) response(r);
        for (const cb of Object.values(o.callbacks || {}))
          for (const [key, item] of Object.entries(cb))
            if (!key.startsWith("x-")) path(item);
      }
  };
  servers(api.servers);
  security(api.security);
  const routes = new Set();
  for (const [route, item] of Object.entries(api.paths))
    if (route.startsWith("/")) {
      const shape = route.replace(/\{[^{}]+\}/g, "{}");
      if (routes.has(shape)) fail("STANDARD_AMBIGUOUS_PATH");
      routes.add(shape);
      path(item);
    }
  const c = api.components || {};
  for (const s of Object.values(c.schemas || {})) schema(s);
  for (const p of Object.values(c.parameters || {})) parameter(p);
  for (const h of Object.values(c.headers || {})) parameter(h);
  for (const b of Object.values(c.requestBodies || {})) content(b.content);
  for (const r of Object.values(c.responses || {})) response(r);
  for (const cb of Object.values(c.callbacks || {}))
    for (const [key, item] of Object.entries(cb))
      if (!key.startsWith("x-")) path(item);
  links.push(...Object.values(c.links || {}));
  for (const link of links)
    if (link.operationId && !ids.has(link.operationId))
      fail("STANDARD_LINK_OPERATION_ID");
}
export function structuralShadow(bundle) {
  const result = shadow(bundle),
    seen = new Set();
  const walk = (v, isSchema = false) => {
    if (!v || typeof v !== "object" || seen.has(v)) return;
    seen.add(v);
    // Actual enum equality is checked using exact arithmetic above; replacing
    // values only in the structural copy avoids IEEE rounding in upstream Ajv.
    if (isSchema) {
      if (Array.isArray(v.enum)) v.enum = v.enum.map((_, i) => i);
      for (const p of Object.values(v.properties || {})) walk(p, true);
      for (const k of ["items", "not", "additionalProperties"])
        walk(v[k], true);
      for (const k of ["allOf", "oneOf", "anyOf"])
        for (const p of v[k] || []) walk(p, true);
      return;
    }
    for (const [k, x] of Object.entries(v)) {
      if (
        k.startsWith("x-") ||
        ["example", "examples", "default", "enum"].includes(k)
      )
        continue;
      if (k === "schemas" || maps.has(k))
        for (const p of Object.values(x)) walk(p, k === "schemas");
      else walk(x, k === "schema");
    }
  };
  walk(result);
  return result;
}

import { SaxesParser } from "saxes";
import { effective, validSchema } from "./standard-schema.mjs";
import {
  number,
  numeric,
  setOwn,
  stringifyExact,
  parseExact,
} from "./standard-value.mjs";
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
function name(s, fallback, bindings = {}) {
  const x = s?.xml || {},
    local = x.name || fallback,
    uri =
      x.namespace ??
      (x.prefix
        ? typeof bindings[x.prefix] === "string"
          ? bindings[x.prefix]
          : x.prefix === "xml"
            ? "http://www.w3.org/XML/1998/namespace"
            : ""
        : "");
  if (
    !/^[\p{L}_][\p{L}\p{N}_.-]*$/u.test(local) ||
    (x.prefix && !/^[\p{L}_][\p{L}\p{N}_.-]*$/u.test(x.prefix))
  )
    throw new Error("STANDARD_XML_NAME");
  if (x.prefix && !uri) throw new Error("STANDARD_XML_NAMESPACE_REQUIRED");
  return {
    local,
    uri,
    q: x.prefix ? x.prefix + ":" + local : local,
    prefix: x.prefix || "",
  };
}
export function encodeXML(
  schema,
  value,
  fallback = "root",
  depth = 0,
  defaultNS = "",
  bindings = {},
) {
  if (depth > 64) throw new Error("STANDARD_XML_BUDGET");
  const s = effective(schema, value),
    n = name(s, fallback, bindings),
    ns =
      n.uri || defaultNS
        ? ` xmlns${n.prefix ? ":" + n.prefix : ""}="${escape(n.uri)}"`
        : "",
    childrenNS = n.prefix ? defaultNS : n.uri,
    scope = { ...bindings, [n.prefix]: n.uri };
  const element = (v) => `<${n.q}${ns}>${v}</${n.q}>`;
  if (Array.isArray(value)) {
    const inside = value
      .map((v) =>
        encodeXML(
          s.items,
          v,
          fallback,
          depth + 1,
          s.xml?.wrapped || depth === 0 ? childrenNS : defaultNS,
          scope,
        ),
      )
      .join("");
    return s.xml?.wrapped || depth === 0 ? element(inside) : inside;
  }
  if (value && typeof value === "object" && !numeric(value)) {
    let attrs = "",
      children = "";
    const property = (k) =>
      Object.hasOwn(s.properties || {}, k)
        ? s.properties[k]
        : s.additionalProperties || {};
    for (const [k, v] of Object.entries(value).sort(
      ([a], [b]) =>
        Number(Boolean(property(b).xml?.attribute)) -
        Number(Boolean(property(a).xml?.attribute)),
    )) {
      const p = Object.hasOwn(s.properties || {}, k)
        ? s.properties[k]
        : s.additionalProperties || {};
      if (p.xml?.attribute) {
        const a = name(p, k, scope);
        if (a.uri && !a.prefix) {
          a.prefix =
            Object.keys(scope).find((k) => k && scope[k] === a.uri) ||
            "ns" + (Object.keys(scope).length + 1);
          a.q = a.prefix + ":" + a.local;
        }
        if (a.prefix && scope[a.prefix] !== a.uri) {
          if (Object.hasOwn(scope, a.prefix))
            throw new Error("STANDARD_XML_NAMESPACE_COLLISION");
          attrs += ` xmlns:${a.prefix}="${escape(a.uri)}"`;
          setOwn(scope, a.prefix, a.uri);
        }
        attrs += ` ${a.q}="${escape(v && typeof v === "object" && !numeric(v) ? stringifyExact(v) : v)}"`;
      } else children += encodeXML(p, v, k, depth + 1, childrenNS, scope);
    }
    return `<${n.q}${ns}${attrs}>${children}</${n.q}>`;
  }
  return element(value === null ? "" : escape(value));
}
export function decodeXML(schema, raw) {
  const parser = new SaxesParser({ xmlns: true }),
    stack = [];
  let root,
    count = 0;
  parser.on("doctype", () => {
    throw new Error("STANDARD_XML_DTD_FORBIDDEN");
  });
  parser.on("error", () => {
    throw new Error("STANDARD_XML_SYNTAX");
  });
  parser.on("opentag", (tag) => {
    if (++count > 10000 || stack.length > 64)
      throw new Error("STANDARD_XML_BUDGET");
    const n = { ...tag, text: "", children: [] };
    if (stack.length) stack.at(-1).children.push(n);
    else root = n;
    stack.push(n);
  });
  parser.on("text", (s) => {
    if (stack.length) stack.at(-1).text += s;
  });
  parser.on("cdata", (s) => {
    if (stack.length) stack.at(-1).text += s;
  });
  parser.on("closetag", () => stack.pop());
  parser.write(raw).close();
  if (!root) throw new Error("STANDARD_XML_ROOT");
  const cast = (s, text) => {
    if (s.xml?.attribute && ["array", "object"].includes(s.type)) {
      try {
        return parseExact(text);
      } catch {
        return text;
      }
    }
    if (["integer", "number"].includes(s.type)) {
      try {
        return number(text);
      } catch {
        return text;
      }
    }
    if (s.type === "boolean" && ["true", "false"].includes(text))
      return text === "true";
    if (s.nullable && text === "") return null;
    return text;
  };
  const match = (n, s, k) => {
    const a = name(s, k, n.ns);
    return n.local === a.local && n.uri === a.uri;
  };
  const decode = (schema, n, fallback, checkName = true) => {
    if (schema?.oneOf || schema?.anyOf) {
      for (const branch of schema.oneOf || schema.anyOf)
        try {
          const composite = {
            ...schema,
            oneOf: undefined,
            anyOf: undefined,
            allOf: [...(schema.allOf || []), branch],
          };
          const v = decode(composite, n, fallback, checkName);
          if (validSchema(schema, v, "read")) return v;
        } catch {}
      throw new Error("STANDARD_XML_COMPOSITION");
    }
    const s = effective(schema),
      out = {};
    if (checkName && !match(n, s, fallback))
      throw new Error("STANDARD_XML_ELEMENT");
    if (s.type === "array")
      return n.children.map((c) => decode(s.items, c, fallback));
    if (s.type === "object" || Object.keys(s.properties || {}).length) {
      const used = new Set();
      for (const [k, p0] of Object.entries(s.properties || {})) {
        const p = effective(p0),
          a = name(p, k, n.ns);
        if (p.xml?.attribute) {
          const v = Object.values(n.attributes).find(
            (v) => v.local === a.local && v.uri === a.uri,
          );
          if (v) {
            setOwn(out, k, cast(p, v.value));
            used.add(v);
          }
        } else if (p.type === "array" && !p.xml?.wrapped) {
          const nodes = n.children.filter((c) => match(c, p.items, k));
          nodes.forEach((c) => used.add(c));
          if (nodes.length || s.required?.includes(k))
            setOwn(
              out,
              k,
              nodes.map((c) => decode(p.items, c, k)),
            );
        } else {
          const nodes = n.children.filter((c) => match(c, p, k));
          if (nodes.length > 1)
            throw new Error("STANDARD_XML_DUPLICATE_ELEMENT");
          if (nodes[0]) {
            used.add(nodes[0]);
            setOwn(out, k, decode(p, nodes[0], k));
          }
        }
      }
      for (const c of n.children)
        if (!used.has(c))
          setOwn(
            out,
            c.local,
            decode(
              typeof s.additionalProperties === "object"
                ? s.additionalProperties
                : {},
              c,
              c.local,
              false,
            ),
          );
      for (const a of Object.values(n.attributes))
        if (a.uri !== "http://www.w3.org/2000/xmlns/" && !used.has(a))
          setOwn(out, a.local, a.value);
      return out;
    }
    if (n.children.length) throw new Error("STANDARD_XML_PRIMITIVE_CHILDREN");
    return cast(s, n.text);
  };
  return decode(schema, root, schema?.xml?.name || root.local);
}

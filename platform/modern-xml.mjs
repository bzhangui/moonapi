// Native OAS3.2 XML data-model mapping. Namespaces and text/CDATA remain
// distinct, DTD/entities are never resolved, and ambiguous mappings fail closed.
import { SaxesParser } from "saxes";
import {
  numeric,
  number,
  stringifyExact,
  parseExact,
  setOwn,
  equal,
} from "./standard-value.mjs";
const XML = "http://www.w3.org/XML/1998/namespace",
  XSI = "http://www.w3.org/2001/XMLSchema-instance";
const own = (o, k) => Object.hasOwn(o ?? {}, k);
const fail = (code) => {
  throw new Error("MODERN_XML_" + code);
};
const validChars = (text) => {
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff\uD800-\uDFFF]/u.test(text))
    fail("CHARACTER");
  return text;
};
const escape = (value) =>
  validChars(String(value)).replace(
    /[&<>"'\r]/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
        "\r": "&#xD;",
      })[c],
  );
function inspect(schema, value, options) {
  if (options.inspectSchema) return options.inspectSchema(schema, value);
  if (options.resolveSchema) {
    const resolved = options.resolveSchema(schema, value);
    if (resolved !== undefined && resolved !== schema)
      return inspect(resolved, value, { ...options, resolveSchema: undefined });
  }
  if (!schema || typeof schema !== "object") return {};
  let result = { ...schema };
  for (const s of schema.allOf ?? []) {
    const child = inspect(s, value, options);
    result = {
      ...child,
      ...result,
      properties: { ...(child.properties ?? {}), ...(result.properties ?? {}) },
      xml: { ...(child.xml ?? {}), ...(result.xml ?? {}) },
    };
  }
  return result;
}
function nodeType(s) {
  const x = s.xml ?? {};
  if (x.nodeType !== undefined && (own(x, "attribute") || own(x, "wrapped")))
    fail("ANNOTATION_CONFLICT");
  const type =
    x.nodeType ??
    (x.attribute
      ? "attribute"
      : x.wrapped
        ? "element"
        : (Array.isArray(s.type)
              ? s.type.includes("array")
              : s.type === "array") ||
            s.$ref ||
            s.$dynamicRef
          ? "none"
          : "element");
  if (!["element", "attribute", "text", "cdata", "none"].includes(type))
    fail("NODE_TYPE");
  return type;
}
function xmlName(s, fallback, bindings, attribute = false) {
  const x = s.xml ?? {},
    local = x.name ?? fallback,
    prefix = x.prefix ?? "";
  if (
    typeof local !== "string" ||
    !/^[\p{L}_][\p{L}\p{N}_.-]*$/u.test(local) ||
    typeof prefix !== "string" ||
    (prefix && !/^[\p{L}_][\p{L}\p{N}_.-]*$/u.test(prefix)) ||
    prefix === "xmlns" ||
    (attribute && !prefix && local === "xmlns")
  )
    fail("NAME");
  let uri =
    x.namespace ??
    (prefix
      ? (bindings[prefix] ?? (prefix === "xml" ? XML : undefined))
      : attribute
        ? ""
        : (bindings[""] ?? ""));
  if (uri === undefined || typeof uri !== "string") fail("NAMESPACE_REQUIRED");
  if (uri && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(uri)) fail("NAMESPACE_IRI");
  if (
    (prefix === "xml" && uri !== XML) ||
    (uri === XML && prefix !== "xml") ||
    uri === "http://www.w3.org/2000/xmlns/"
  )
    fail("NAMESPACE_RESERVED");
  return { local, prefix, uri, q: prefix ? prefix + ":" + local : local };
}
function scalar(value) {
  return value === null
    ? ""
    : value && typeof value === "object" && !numeric(value)
      ? stringifyExact(value)
      : String(value);
}
function rootFallback(schema, options) {
  return (
    options.rootName ?? options.inferredName ?? schema?.__moonapi_component_name
  );
}
export function encodeModernXML(schema, value, options = {}) {
  let nodes = 0;
  const render = (original, data, fallback, parentBindings, depth) => {
    if (++nodes > 10000 || depth > 64) fail("BUDGET");
    const s = inspect(original, data, options),
      kind = nodeType(s);
    const result = {
      text: "",
      attributes: "",
      declarations: "",
      bindings: { ...parentBindings },
      attributeKeys: new Set(),
    };
    if (kind === "attribute") {
      if (data === null) return result;
      const bindings = result.bindings,
        n = xmlName(s, fallback, bindings, true);
      if (n.uri && !n.prefix) {
        n.prefix =
          Object.keys(bindings).find((p) => p && bindings[p] === n.uri) ??
          "ns" + Object.keys(bindings).length;
        n.q = n.prefix + ":" + n.local;
      }
      if (n.prefix && bindings[n.prefix] !== n.uri) {
        if (own(bindings, n.prefix)) fail("NAMESPACE_COLLISION");
        result.declarations = " xmlns:" + n.prefix + '="' + escape(n.uri) + '"';
        setOwn(bindings, n.prefix, n.uri);
      }
      result.attributes =
        " " +
        n.q +
        '="' +
        escape(scalar(data)).replace(/\n/g, "&#xA;").replace(/\t/g, "&#x9;") +
        '"';
      result.attributeKeys.add(n.uri + "\0" + n.local);
      return result;
    }
    if (kind === "text") {
      result.text = escape(scalar(data));
      return result;
    }
    if (kind === "cdata") {
      if (scalar(data).includes("\r")) fail("CDATA_CARRIAGE_RETURN");
      result.text =
        "<![CDATA[" +
        validChars(scalar(data)).replace(/\]\]>/g, "]]]]><![CDATA[>") +
        "]]>";
      return result;
    }
    let bindings = result.bindings,
      n,
      declarations = "",
      content = "";
    if (kind === "element") {
      n = xmlName(s, fallback, bindings);
      if ((bindings[n.prefix] ?? "") !== n.uri) {
        declarations +=
          " xmlns" +
          (n.prefix ? ":" + n.prefix : "") +
          '="' +
          escape(n.uri) +
          '"';
        setOwn(bindings, n.prefix, n.uri);
      }
    }
    if (data === null) {
      if (kind === "none") return result;
      if (bindings.xsi !== XSI) declarations += ' xmlns:xsi="' + XSI + '"';
      result.text = "<" + n.q + declarations + ' xsi:nil="true"/>';
      return result;
    }
    const append = (child) => {
      for (const key of child.attributeKeys) {
        if (result.attributeKeys.has(key)) fail("DUPLICATE_ATTRIBUTE");
        result.attributeKeys.add(key);
      }
      result.attributes += child.attributes;
      declarations += child.declarations;
      bindings = child.bindings;
      content += child.text;
    };
    if (Array.isArray(data)) {
      for (let i = 0; i < data.length; i++)
        append(
          render(
            s.prefixItems?.[i] ?? s.items ?? {},
            data[i],
            fallback,
            bindings,
            depth + 1,
          ),
        );
    } else if (
      data &&
      typeof data === "object" &&
      !numeric(data) &&
      !Buffer.isBuffer(data)
    ) {
      const prop = (k) =>
        own(s.properties, k)
          ? s.properties[k]
          : typeof s.additionalProperties === "object"
            ? s.additionalProperties
            : {};
      for (const kind of ["text", "cdata"])
        if (
          Object.entries(data).filter(
            ([k]) => nodeType(inspect(prop(k), data[k], options)) === kind,
          ).length > 1
        )
          fail("AMBIGUOUS_TEXT");
      for (const [k, v] of Object.entries(data))
        if (nodeType(inspect(prop(k), v, options)) === "attribute")
          append(render(prop(k), v, k, bindings, depth + 1));
      for (const [k, v] of Object.entries(data))
        if (nodeType(inspect(prop(k), v, options)) !== "attribute")
          append(render(prop(k), v, k, bindings, depth + 1));
    } else content = escape(scalar(data));
    if (kind === "none") {
      result.text = content;
      result.declarations = declarations;
      result.bindings = bindings;
      return result;
    }
    return {
      text:
        "<" +
        n.q +
        declarations +
        result.attributes +
        ">" +
        content +
        "</" +
        n.q +
        ">",
      attributes: "",
      declarations: "",
      bindings: parentBindings,
      attributeKeys: new Set(),
    };
  };
  const result = render(
    schema,
    value,
    rootFallback(schema, options),
    { xml: XML, "": "" },
    0,
  );
  if (result.attributes) fail("ATTRIBUTE_PARENT");
  if (Buffer.byteLength(result.text) > (options.maxBytes ?? 1048576))
    fail("BYTE_BUDGET");
  return result.text;
}
function mergeMetadata(base, branch) {
  const out = {
    ...base,
    ...branch,
    xml: { ...(base.xml ?? {}), ...(branch.xml ?? {}) },
  };
  if (base.properties || branch.properties) {
    out.properties = { ...(base.properties ?? {}) };
    for (const [key, child] of Object.entries(branch.properties ?? {}))
      setOwn(
        out.properties,
        key,
        own(out.properties, key)
          ? mergeMetadata(out.properties[key], child)
          : child,
      );
  }
  return out;
}
function metadataViews(schema, options, state = { nodes: 0 }, depth = 0) {
  if (++state.nodes > 2048 || depth > 16) fail("BRANCH_BUDGET");
  const base = inspect(schema, undefined, options),
    out = [base];
  const branches = [
    ...(base.oneOf ?? []),
    ...(base.anyOf ?? []),
    ...(base.then !== undefined ? [base.then] : []),
    ...(base.else !== undefined ? [base.else] : []),
    ...Object.values(base.dependentSchemas ?? {}),
  ];
  for (const branch of branches)
    for (const view of metadataViews(branch, options, state, depth + 1)) {
      out.push(mergeMetadata(base, view));
      if (out.length >= 64) return out;
    }
  return out;
}
export function decodeModernXML(schema, raw, options = {}) {
  const readerOptions = options._readerOptions ?? options,
    direct = {
      ...options,
      inspectSchema: (s) => s,
      _readerOptions: readerOptions,
    };
  let last;
  for (const view of metadataViews(schema, readerOptions)) {
    try {
      let value = decodeXMLView(view, raw, direct);
      for (let confirmation = 0; confirmation < 4; confirmation++) {
        const active = inspect(schema, value, readerOptions),
          again = decodeXMLView(active, raw, direct);
        if (
          equal(value, again) &&
          (!options.validate ||
            options.validate(schema, again) === true ||
            options.validate(schema, again)?.valid === true)
        )
          return again;
        value = again;
      }
    } catch (error) {
      last = error;
    }
  }
  if (last) throw last;
  fail("BRANCH_OR_SCHEMA");
}
function decodeXMLView(schema, raw, options = {}) {
  if (
    typeof raw !== "string" ||
    Buffer.byteLength(raw) > (options.maxBytes ?? 1048576)
  )
    fail("BYTE_BUDGET");
  const parser = new SaxesParser({
      xmlns: true,
      fragment: nodeType(inspect(schema, undefined, options)) !== "element",
    }),
    roots = [],
    stack = [];
  let nodes = 0;
  const append = (node) => {
    const list = stack.length ? stack.at(-1).children : roots;
    const last = list.at(-1);
    if (
      (node.kind === "text" || node.kind === "cdata") &&
      last?.kind === node.kind
    )
      last.value += node.value;
    else list.push(node);
  };
  parser.on("doctype", () => fail("DTD_FORBIDDEN"));
  parser.on("error", () => fail("SYNTAX"));
  parser.on("opentag", (tag) => {
    if (++nodes > 10000 || stack.length >= 64) fail("BUDGET");
    const node = {
      kind: "element",
      local: tag.local,
      uri: tag.uri,
      prefix: tag.prefix,
      ns: tag.ns,
      attrs: Object.values(tag.attributes),
      children: [],
    };
    append(node);
    stack.push(node);
  });
  parser.on("text", (value) => {
    if (++nodes > 10000) fail("BUDGET");
    append({ kind: "text", value });
  });
  parser.on("cdata", (value) => {
    if (++nodes > 10000) fail("BUDGET");
    append({ kind: "cdata", value });
  });
  parser.on("closetag", () => stack.pop());
  parser.write(raw).close();
  let visits = 0;
  const cast = (s, text) => {
    const types = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
    if (options.castWire && !types.some((t) => ["object", "array"].includes(t)))
      return options.castWire(s, text, options);
    if (types.includes("string") || !types.length) return text;
    if (types.includes("number") || types.includes("integer")) {
      try {
        return number(text);
      } catch {
        return text;
      }
    }
    if (types.includes("boolean") && ["true", "false"].includes(text))
      return text === "true";
    if (types.includes("null") && text === "") return null;
    if (types.includes("object") || types.includes("array")) {
      try {
        return parseExact(text);
      } catch {
        return text;
      }
    }
    return text;
  };
  const matches = (node, s, fallback, attribute = false) => {
    const n = xmlName(s, fallback, node.ns ?? { "": "", xml: XML }, attribute);
    return node.local === n.local && node.uri === n.uri;
  };
  const decodeElement = (original, node, fallback, depth) => {
    if (++visits > 50000 || depth > 64) fail("BUDGET");
    const s = inspect(original, undefined, options);
    const nil = node.attrs.find((a) => a.local === "nil" && a.uri === XSI);
    if (nil && !["true", "1", "false", "0"].includes(nil.value))
      fail("NIL_VALUE");
    if (nil && ["true", "1"].includes(nil.value)) {
      if (
        node.children.some((n) => n.kind === "element" || n.value.trim()) ||
        node.attrs.some(
          (a) => a !== nil && a.uri !== "http://www.w3.org/2000/xmlns/",
        )
      )
        fail("NIL_CONTENT");
      return null;
    }
    const types = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
    if (types.includes("array"))
      return decodeSequence(s, node.children, fallback, depth + 1);
    if (
      types.includes("object") ||
      s.properties ||
      node.children.some((n) => n.kind === "element")
    )
      return decodeObject(s, node, depth + 1);
    if (node.children.some((n) => n.kind === "element")) fail("SCALAR_CONTENT");
    return cast(
      s,
      node.children
        .filter((n) => n.kind === "text" || n.kind === "cdata")
        .map((n) => n.value)
        .join(""),
    );
  };
  const decodeNode = (s, node, fallback, depth) => {
    let last;
    for (const inspected of metadataViews(
      s,
      options._readerOptions ?? options,
    )) {
      try {
        const kind = nodeType(inspected);
        if (kind === "text" || kind === "cdata") {
          if (node?.kind !== kind) fail("NODE_MISMATCH");
          return cast(inspected, node.value);
        }
        if (
          kind !== "element" ||
          node?.kind !== "element" ||
          !matches(node, inspected, fallback)
        )
          continue;
        const value = decodeElement(inspected, node, fallback, depth + 1);
        if (
          !options.validate ||
          options.validate(s, value) === true ||
          options.validate(s, value)?.valid === true
        )
          return value;
      } catch (error) {
        last = error;
      }
    }
    if (last) throw last;
    fail("NODE_MISMATCH");
  };
  const meaningful = (list) =>
    list.filter((n) => n.kind !== "text" || n.value.trim() !== "");
  const decodeSequence = (s, list, fallback, depth) => {
    const out = [],
      prefix = s.prefixItems ?? [];
    let at = 0;
    for (;;) {
      const ps = inspect(
          prefix[out.length] ?? s.items ?? {},
          undefined,
          options,
        ),
        kind = nodeType(ps);
      while (
        at < list.length &&
        list[at].kind === "text" &&
        !list[at].value.trim() &&
        kind !== "text"
      )
        at++;
      if (at >= list.length) break;
      if (kind === "none") fail("AMBIGUOUS_SEQUENCE");
      out.push(decodeNode(ps, list[at++], fallback, depth + 1));
      if (out.length > 256) fail("ARRAY_BUDGET");
    }
    return out;
  };
  const decodeObject = (s, node, depth, shared = undefined) => {
    const output = {},
      used = shared?.used ?? new Set(),
      attrsUsed = shared?.attrsUsed ?? new Set();
    for (const [key, original] of Object.entries(s.properties ?? {})) {
      const p = inspect(original, undefined, options),
        kind = nodeType(p),
        types = Array.isArray(p.type) ? p.type : [p.type];
      if (kind === "attribute") {
        const attribute = node.attrs.find(
          (a) =>
            !attrsUsed.has(a) && matches({ ...a, ns: node.ns }, p, key, true),
        );
        if (attribute) {
          attrsUsed.add(attribute);
          setOwn(output, key, cast(p, attribute.value));
        } else if (types.includes("null") && s.required?.includes(key))
          setOwn(output, key, null);
        continue;
      }
      if (kind === "text" || kind === "cdata") {
        const values = node.children.filter(
          (n) => !used.has(n) && n.kind === kind,
        );
        if (values.length) {
          for (const n of values) used.add(n);
          setOwn(output, key, cast(p, values.map((n) => n.value).join("")));
        }
        continue;
      }
      if (kind === "none" && types.includes("object")) {
        const value = decodeObject(p, node, depth + 1, { used, attrsUsed });
        if (Object.keys(value).length) setOwn(output, key, value);
        continue;
      }
      if (kind === "none" && types.includes("array")) {
        const items = [];
        for (const child of node.children)
          if (!used.has(child)) {
            const item = inspect(
              p.prefixItems?.[items.length] ?? p.items ?? {},
              undefined,
              options,
            );
            if (
              child.kind === "element" &&
              metadataViews(item, options._readerOptions ?? options).some(
                (v) => nodeType(v) === "element" && matches(child, v, key),
              )
            ) {
              used.add(child);
              items.push(decodeNode(item, child, key, depth + 1));
            }
          }
        if (items.length || s.required?.includes(key))
          setOwn(output, key, items);
        continue;
      }
      const found = node.children.filter(
        (n) =>
          !used.has(n) &&
          n.kind === "element" &&
          metadataViews(p, options._readerOptions ?? options).some(
            (v) => nodeType(v) === "element" && matches(n, v, key),
          ),
      );
      if (found.length > 1) fail("DUPLICATE_ELEMENT");
      if (found.length) {
        used.add(found[0]);
        setOwn(output, key, decodeNode(p, found[0], key, depth + 1));
      }
    }
    if (!shared) {
      for (const a of node.attrs)
        if (
          !attrsUsed.has(a) &&
          a.uri !== "http://www.w3.org/2000/xmlns/" &&
          !(a.uri === XSI && a.local === "nil")
        ) {
          if (own(output, a.local)) fail("AMBIGUOUS_PROPERTY");
          setOwn(output, a.local, a.value);
        }
      for (const child of node.children)
        if (!used.has(child) && child.kind === "element") {
          const ps =
            typeof s.additionalProperties === "object"
              ? s.additionalProperties
              : {};
          const value = decodeElement(ps, child, child.local, depth + 1);
          if (own(output, child.local)) fail("DUPLICATE_ELEMENT");
          setOwn(output, child.local, value);
        }
      for (const child of node.children)
        if (
          !used.has(child) &&
          (child.kind === "text" || child.kind === "cdata") &&
          child.value.trim()
        )
          fail("UNMAPPED_TEXT");
    }
    return output;
  };
  const s = inspect(schema, undefined, options),
    kind = nodeType(s);
  if (
    kind === "none" &&
    (s.type === "array" || (Array.isArray(s.type) && s.type.includes("array")))
  )
    return decodeSequence(s, roots, rootFallback(s, options), 0);
  const rootsOnly = meaningful(roots);
  if (rootsOnly.length !== 1) fail("ROOT");
  return decodeNode(s, rootsOnly[0], rootFallback(s, options), 0);
}

// Resolve granted schema resources offline, then specialize dynamic references
// into static references per outermost dynamic-anchor binding. This avoids a
// dependency's runtime anchor-registration bug without flattening constraints.
import { stringifyExact } from "./standard-value.mjs";
const singles = [
  "not",
  "if",
  "then",
  "else",
  "items",
  "contains",
  "propertyNames",
  "additionalProperties",
  "unevaluatedProperties",
  "unevaluatedItems",
  "contentSchema",
];
const lists = ["allOf", "anyOf", "oneOf", "prefixItems"];
const maps = [
  "$defs",
  "definitions",
  "properties",
  "patternProperties",
  "dependentSchemas",
];
const esc = (s) => s.replace(/~/g, "~0").replace(/\//g, "~1");
const key = (uri) => {
  const u = new URL(uri);
  return u.href.split("#")[0] + "#" + decodeURIComponent(u.hash.slice(1));
};
const fail = () => {
  throw new Error("MODERN_SCHEMA_INVALID_OR_UNGRANTED");
};
export function specializeModernResources(schema, documents) {
  const registry = new Map(),
    anchors = new Map();
  let count = 0;
  const register = (uri, info) => {
    const k = key(uri),
      old = registry.get(k);
    if (old && old !== info) fail();
    registry.set(k, info);
  };
  const scan = (
    s,
    docURI,
    path = "",
    base = docURI,
    scopes = [{ uri: docURI, path: "" }],
    depth = 0,
  ) => {
    if (
      ++count > 50000 ||
      depth > 64 ||
      (typeof s !== "boolean" &&
        (!s || typeof s !== "object" || Array.isArray(s)))
    )
      fail();
    if (
      s &&
      s.$schema !== undefined &&
      s.$schema !== "https://json-schema.org/draft/2020-12/schema"
    )
      throw new Error("MODERN_SCHEMA_DIALECT_UNSUPPORTED");
    if (s && s.$id !== undefined) {
      const u = new URL(s.$id, base);
      if (u.hash || u.username || u.password) fail();
      base = u.href;
      if (!scopes.some((x) => x.uri === base && x.path === path))
        scopes = [...scopes, { uri: base, path }];
    }
    const info = { index: count, schema: s, base, children: new Map() };
    for (const scope of scopes)
      register(scope.uri + "#" + path.slice(scope.path.length), info);
    if (typeof s === "boolean") return info;
    for (const name of [s.$anchor, s.$dynamicAnchor])
      if (typeof name === "string") register(base + "#" + name, info);
    if (typeof s.$dynamicAnchor === "string") {
      if (!anchors.has(base)) anchors.set(base, new Map());
      anchors.get(base).set(s.$dynamicAnchor, info);
    }
    for (const k of singles)
      if (Object.hasOwn(s, k))
        info.children.set(
          k,
          scan(s[k], docURI, path + "/" + esc(k), base, scopes, depth + 1),
        );
    for (const k of lists)
      if (Object.hasOwn(s, k)) {
        if (!Array.isArray(s[k])) fail();
        info.children.set(
          k,
          s[k].map((v, i) =>
            scan(
              v,
              docURI,
              path + "/" + esc(k) + "/" + i,
              base,
              scopes,
              depth + 1,
            ),
          ),
        );
      }
    for (const k of maps)
      if (Object.hasOwn(s, k)) {
        if (!s[k] || typeof s[k] !== "object" || Array.isArray(s[k])) fail();
        info.children.set(
          k,
          new Map(
            Object.entries(s[k]).map(([name, v]) => [
              name,
              scan(
                v,
                docURI,
                path + "/" + esc(k) + "/" + esc(name),
                base,
                scopes,
                depth + 1,
              ),
            ]),
          ),
        );
      }
    return info;
  };
  const rootURI = "https://moonapi.invalid/original-schema.json";
  const root = scan(schema, rootURI);
  for (const [uri, document] of Object.entries(documents)) {
    const u = new URL(uri);
    if (u.hash || u.username || u.password || u.href === rootURI) fail();
    scan(document, u.href);
  }
  const resolve = (reference, info) => {
    if (typeof reference !== "string") fail();
    const found = registry.get(key(new URL(reference, info.base).href));
    if (!found) fail();
    return found;
  };
  const variants = new Map(),
    output = {};
  let total = 0;
  const specialize = (info, inherited = new Map()) => {
    // A resource contributes all its declared anchors, including anchors in
    // $defs that have not themselves been evaluated. Outermost wins.
    const binding = new Map(inherited);
    for (const [name, target] of anchors.get(info.base) || [])
      if (!binding.has(name)) binding.set(name, target);
    const state = JSON.stringify([
      info.index,
      [...binding]
        .map(([name, target]) => [name, target.index])
        .sort((a, b) => a[0].localeCompare(b[0])),
    ]);
    if (variants.has(state)) return variants.get(state);
    if (variants.size >= 1024) throw new Error("MODERN_SCHEMA_RESOURCE_BUDGET");
    const uri = "https://moonapi.invalid/specialized/" + variants.size;
    variants.set(state, uri);
    const s = info.schema;
    if (typeof s === "boolean") {
      output[uri] = s;
      return uri;
    }
    const compiled = {};
    for (const [k, v] of Object.entries(s)) {
      if (
        [
          "$id",
          "$anchor",
          "$dynamicAnchor",
          "$schema",
          "$defs",
          "definitions",
        ].includes(k)
      )
        continue;
      if (k === "$ref" || k === "$dynamicRef") {
        let target = resolve(v, info);
        const fragment = decodeURIComponent(
          new URL(v, info.base).hash.slice(1),
        );
        if (
          k === "$dynamicRef" &&
          fragment &&
          !fragment.startsWith("/") &&
          target.schema?.$dynamicAnchor === fragment
        )
          target = binding.get(fragment) ?? target;
        // If a schema contains both ref forms, neither assertion may disappear.
        const ref = { $ref: specialize(target, binding) };
        if (compiled.$ref) (compiled.allOf ??= []).push(ref);
        else compiled.$ref = ref.$ref;
        continue;
      }
      if (singles.includes(k))
        compiled[k] = { $ref: specialize(info.children.get(k), binding) };
      else if (lists.includes(k)) {
        const children = info.children
          .get(k)
          .map((child) => ({ $ref: specialize(child, binding) }));
        if (k === "allOf" && compiled.allOf) compiled.allOf.push(...children);
        else compiled[k] = children;
      } else if (maps.includes(k)) {
        const m = {};
        for (const [name, child] of info.children.get(k))
          Object.defineProperty(m, name, {
            enumerable: true,
            value: { $ref: specialize(child, binding) },
          });
        compiled[k] = m;
      } else
        Object.defineProperty(compiled, k, {
          enumerable: true,
          configurable: true,
          writable: true,
          value: v,
        });
    }
    total += Buffer.byteLength(stringifyExact(compiled));
    if (total > 4194304) throw new Error("MODERN_SCHEMA_RESOURCE_BUDGET");
    output[uri] = compiled;
    return uri;
  };
  return { schema: { $ref: specialize(root) }, documents: output };
}

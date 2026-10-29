// Native OAS 3.1/3.2 preparation. Schema Objects are never projected to 3.0.
// All documents are parsed/indexed before references are resolved. URI lookup is
// an in-memory grant table; no resolver ever reads a file or performs HTTP.
import {
  Source,
  BaseResolver,
  createConfig,
  lintDocument,
  Oas3_1Types,
  Oas3_2Types,
} from "@redocly/openapi-core";
import { parseDefinition } from "./definition.mjs";
import { cloneExact, numeric, shadow, setOwn } from "./standard-value.mjs";
import { createHash } from "node:crypto";

const has = (o, k) => Object.hasOwn(o, k);
const object = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v) && !numeric(v);
const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};
const esc = (s) => s.replace(/~/g, "~0").replace(/\//g, "~1");
const physicalURI = (uri, path) => uri + "#" + encodeURIComponent(path);
const externalRegistryURI = (key) => {
  const index = key.indexOf("#");
  return key.slice(0, index) + "#" + encodeURIComponent(key.slice(index + 1));
};
const fixedMethods = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
  "query",
];
const methodToken = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const componentKinds = {
  schemas: "schema",
  parameters: "parameter",
  headers: "header",
  requestBodies: "requestBody",
  responses: "response",
  examples: "example",
  links: "link",
  callbacks: "callback",
  securitySchemes: "security",
  pathItems: "path",
  mediaTypes: "media",
};
const schemaSingle = [
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
const schemaLists = ["allOf", "anyOf", "oneOf", "prefixItems"];
const schemaMaps = [
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
];
const referenceKinds = new Set([
  "parameter",
  "header",
  "requestBody",
  "response",
  "example",
  "link",
  "callback",
  "security",
  "media",
]);
const summaryKinds = new Set(["example", "response"]);
const descriptionKinds = new Set([
  "parameter",
  "header",
  "requestBody",
  "response",
  "example",
  "link",
  "security",
]);
const knownDialects = new Set([
  "https://json-schema.org/draft/2020-12/schema",
  "https://spec.openapis.org/oas/3.1/dialect/base",
  "https://spec.openapis.org/oas/3.2/dialect/base",
  "https://spec.openapis.org/oas/3.1/dialect/2024-11-10",
  "https://spec.openapis.org/oas/3.1/dialect/2024-10-25",
  "https://spec.openapis.org/oas/3.2/dialect/2026-02-26",
  "https://spec.openapis.org/oas/3.2/dialect/2025-09-17",
]);
export function defaultModernDialect(version) {
  if (/^3\.1\.\d+$/.test(version))
    return "https://spec.openapis.org/oas/3.1/dialect/2024-11-10";
  if (/^3\.2\.\d+$/.test(version))
    return "https://spec.openapis.org/oas/3.2/dialect/2026-02-26";
  fail("MODERN_OPENAPI_VERSION");
}
function absolute(uri, base) {
  if (typeof uri !== "string" || /[\u0000-\u0020<>"\\^`{|}]/u.test(uri))
    fail("MODERN_REFERENCE_URI");
  let u;
  try {
    u = new URL(uri, base);
  } catch {
    fail("MODERN_REFERENCE_URI");
  }
  if (u.username || u.password) fail("MODERN_REFERENCE_URI");
  return u.href;
}
function uriKey(uri) {
  const u = new URL(uri);
  let fragment;
  try {
    fragment = decodeURIComponent(u.hash.slice(1));
  } catch {
    fail("MODERN_REFERENCE_URI");
  }
  return u.href.split("#")[0] + "#" + fragment;
}
function pointer(value, fragment) {
  if (!fragment) return value;
  if (!fragment.startsWith("/") || /~(?![01])/u.test(fragment))
    return undefined;
  for (const token of fragment.slice(1).split("/")) {
    const key = token.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!object(value) && !Array.isArray(value)) return undefined;
    if (!has(value, key)) return undefined;
    value = value[key];
  }
  return value;
}

export function modernMethods(item, version = "3.2.1") {
  const out = [];
  for (const key of fixedMethods)
    if (has(item, key)) {
      if (key === "query" && version.startsWith("3.1."))
        fail("MODERN_METHOD_VERSION");
      out.push({ key, method: key.toUpperCase(), op: item[key] });
    }
  if (has(item, "additionalOperations")) {
    if (version.startsWith("3.1.") || !object(item.additionalOperations))
      fail("MODERN_METHOD_VERSION");
    for (const [method, op] of Object.entries(item.additionalOperations)) {
      if (
        !methodToken.test(method) ||
        fixedMethods.some((fixed) => fixed.toUpperCase() === method)
      )
        fail("MODERN_ADDITIONAL_METHOD");
      out.push({ key: "additionalOperations/" + esc(method), method, op });
    }
  }
  return out;
}

export async function prepareModernDocument(
  source,
  { documents = {}, documentURI = "https://moonapi.invalid/openapi.json" } = {},
) {
  if (typeof source !== "string") fail("MODERN_DOCUMENT_ENCODING");
  if (!object(documents) || Object.keys(documents).length > 16)
    fail("MODERN_REFERENCE_BUDGET");
  const retrieval = absolute(documentURI);
  if (new URL(retrieval).hash) fail("MODERN_DOCUMENT_URI");
  let bytes = Buffer.byteLength(source ?? "");
  const records = [],
    documentsByURI = new Map(),
    locations = new WeakMap(),
    schemaLocations = new WeakMap(),
    schemaRegistry = new Map(),
    schemaRoots = [],
    references = [],
    indexed = new Map(),
    externalValues = new Set(),
    semanticResourceURIs = new Set();
  let visited = 0;
  const registerDocument = (uri, text, entry = false) => {
    if (
      typeof text !== "string" ||
      (entry ? false : (bytes += Buffer.byteLength(text)) > 4194304)
    )
      fail("MODERN_REFERENCE_BUDGET");
    let raw,
      parseFailed = false;
    try {
      raw = parseDefinition(text);
    } catch {
      if (entry) fail("MODERN_DOCUMENT_ENCODING");
      parseFailed = true;
    }
    const declaresOAD = object(raw) && typeof raw.openapi === "string";
    const isOAD = declaresOAD && /^3\.[12]\.\d+$/.test(raw.openapi);
    if (entry && (!isOAD || !/^3\.[12]\.\d+$/.test(raw.openapi)))
      fail("MODERN_OPENAPI_VERSION");
    // External bytes may be a serialized Example rather than an OAD, even
    // when business data happens to contain `openapi` and `$self` members.
    // Defer interpreting external identities until semantic usage is known.
    const self =
      entry && isOAD && has(raw, "$self") ? absolute(raw.$self, uri) : uri;
    if (entry && isOAD && raw.openapi.startsWith("3.1.") && has(raw, "$self"))
      fail("MODERN_SELF_VERSION");
    const canonical = self.split("#")[0],
      record = {
        raw,
        parseFailed,
        retrievalURI: uri,
        documentURI: canonical,
        identity: self,
        text,
        isOAD,
        entry,
        version: isOAD ? raw.openapi : undefined,
        identityPending: isOAD && !entry,
      };
    for (const alias of [uri, canonical, self]) {
      const key = uriKey(alias);
      if (documentsByURI.has(key) && documentsByURI.get(key) !== record)
        fail("MODERN_DOCUMENT_IDENTITY_COLLISION");
      documentsByURI.set(key, record);
    }
    records.push(record);
    return record;
  };
  const entry = registerDocument(retrieval, source, true);
  for (const [uri, text] of Object.entries(documents)) {
    const address = absolute(uri);
    if (new URL(address).hash || address === retrieval)
      fail("MODERN_REFERENCE_URI");
    registerDocument(address, text);
  }
  const activateIdentity = (record) => {
    if (!record.identityPending) return;
    const self = has(record.raw, "$self")
      ? absolute(record.raw.$self, record.retrievalURI)
      : record.retrievalURI;
    if (record.version.startsWith("3.1.") && has(record.raw, "$self"))
      fail("MODERN_SELF_VERSION");
    const canonical = self.split("#")[0];
    for (const alias of [canonical, self]) {
      const key = uriKey(alias);
      if (documentsByURI.has(key) && documentsByURI.get(key) !== record)
        fail("MODERN_DOCUMENT_IDENTITY_COLLISION");
      documentsByURI.set(key, record);
    }
    record.documentURI = canonical;
    record.identity = self;
    record.identityPending = false;
  };
  const externalResource = (record) =>
    [...externalValues].some(
      (address) => address.split("#")[0] === record.retrievalURI.split("#")[0],
    );
  const index = (
    node,
    kind,
    record,
    path = "",
    base = record.documentURI,
    dialect = record.isOAD && record.raw.jsonSchemaDialect !== undefined
      ? absolute(record.raw.jsonSchemaDialect, record.documentURI)
      : defaultModernDialect(record.version ?? entry.version),
    depth = 0,
    rootSchema = true,
  ) => {
    if (++visited > 100000 || depth > 64) fail("MODERN_RESOURCE_BUDGET");
    if (kind === "schema" && typeof node === "boolean") {
      for (const alias of [record.documentURI, record.retrievalURI])
        schemaRegistry.set(uriKey(physicalURI(alias, path)), node);
      if (rootSchema)
        schemaRoots.push({
          schema: node,
          uri: physicalURI(record.documentURI, path),
          dialect,
          base,
        });
      return;
    }
    if (!object(node)) fail("MODERN_DOCUMENT_STRUCTURE");
    const location = {
      uri: physicalURI(record.documentURI, path),
      documentURI: record.documentURI,
      pointer: path,
      base,
      dialect,
      kind,
      record,
    };
    if (kind === "schema") {
      if (has(node, "$schema")) {
        const selected = absolute(node.$schema, base);
        if (!knownDialects.has(selected))
          fail("MODERN_SCHEMA_DIALECT_UNSUPPORTED");
        dialect = selected;
      }
      if (has(node, "$id")) {
        base = absolute(node.$id, base);
        if (new URL(base).hash) fail("MODERN_SCHEMA_ID");
      }
      Object.assign(location, { base, dialect });
      schemaLocations.set(node, location);
      for (const alias of [record.documentURI, record.retrievalURI])
        schemaRegistry.set(uriKey(physicalURI(alias, path)), node);
      if (has(node, "$id")) {
        const key = uriKey(base),
          old = schemaRegistry.get(key);
        if (old !== undefined && old !== node)
          fail("MODERN_SCHEMA_ID_COLLISION");
        schemaRegistry.set(key, node);
      }
      for (const name of [node.$anchor, node.$dynamicAnchor])
        if (name !== undefined) {
          if (
            typeof name !== "string" ||
            !/^[A-Za-z_][-A-Za-z0-9._]*$/.test(name)
          )
            fail("MODERN_SCHEMA_ANCHOR");
          const address = uriKey(base.split("#")[0] + "#" + name),
            old = schemaRegistry.get(address);
          if (old !== undefined && old !== node)
            fail("MODERN_SCHEMA_ANCHOR_COLLISION");
          schemaRegistry.set(address, node);
        }
      if (rootSchema)
        schemaRoots.push({ schema: node, uri: location.uri, dialect, base });
    }
    locations.set(node, location);
    if (kind === "link" && typeof node.operationRef === "string")
      semanticResourceURIs.add(absolute(node.operationRef, base).split("#")[0]);
    if (["oad", "operation"].includes(kind) && Array.isArray(node.security))
      for (const requirement of node.security)
        if (object(requirement))
          for (const name of Object.keys(requirement))
            if (
              !has(entry.raw.components?.securitySchemes ?? {}, name) &&
              !has(record.raw.components?.securitySchemes ?? {}, name)
            )
              semanticResourceURIs.add(absolute(name, base).split("#")[0]);
    for (const alias of [record.documentURI, record.retrievalURI]) {
      const key = uriKey(physicalURI(alias, path)),
        old = indexed.get(key);
      if (old && old.node !== node) fail("MODERN_REFERENCE_AMBIGUOUS");
      indexed.set(key, { node, kind, record, location });
    }
    const child = (value, childKind, suffix, isRoot = true) =>
      index(
        value,
        childKind,
        record,
        path + suffix,
        base,
        dialect,
        depth + 1,
        isRoot,
      );
    const field = (name, childKind) => {
      if (has(node, name)) child(node[name], childKind, "/" + esc(name));
    };
    const list = (name, childKind) => {
      if (!has(node, name)) return;
      if (!Array.isArray(node[name])) fail("MODERN_DOCUMENT_STRUCTURE");
      node[name].forEach((v, i) =>
        child(v, childKind, "/" + esc(name) + "/" + i),
      );
    };
    const map = (name, childKind) => {
      if (!has(node, name)) return;
      if (!object(node[name])) fail("MODERN_DOCUMENT_STRUCTURE");
      for (const [key, value] of Object.entries(node[name])) {
        if (["paths", "responses"].includes(name) && key.startsWith("x-"))
          continue;
        child(value, childKind, "/" + esc(name) + "/" + esc(key));
      }
    };
    if (
      kind !== "schema" &&
      (kind === "path" || referenceKinds.has(kind)) &&
      typeof node.$ref === "string"
    ) {
      if (kind === "media" && record.version?.startsWith("3.1."))
        fail("MODERN_MEDIA_REFERENCE_VERSION");
      references.push({ ref: node.$ref, base, kind, node, location });
      if (kind !== "path") return;
    }
    switch (kind) {
      case "oad":
        if (
          has(node, "jsonSchemaDialect") &&
          !knownDialects.has(absolute(node.jsonSchemaDialect, base))
        )
          fail("MODERN_SCHEMA_DIALECT_UNSUPPORTED");
        map("paths", "path");
        map("webhooks", "path");
        if (has(node, "components"))
          for (const [category, value] of Object.entries(node.components)) {
            if (category.startsWith("x-")) continue;
            if (!componentKinds[category] || !object(value))
              fail("MODERN_COMPONENTS");
            if (record.version.startsWith("3.1.") && category === "mediaTypes")
              fail("MODERN_COMPONENTS_VERSION");
            for (const [name, item] of Object.entries(value)) {
              if (!/^[A-Za-z0-9._-]+$/.test(name))
                fail("MODERN_COMPONENT_NAME");
              child(
                item,
                componentKinds[category],
                "/components/" + category + "/" + esc(name),
              );
            }
          }
        break;
      case "path":
        for (const { key, op } of modernMethods(
          node,
          record.version ?? entry.version,
        ))
          child(op, "operation", "/" + key);
        list("parameters", "parameter");
        break;
      case "operation":
        list("parameters", "parameter");
        field("requestBody", "requestBody");
        map("responses", "response");
        map("callbacks", "callback");
        break;
      case "parameter":
      case "header":
        field("schema", "schema");
        map("content", "media");
        map("examples", "example");
        break;
      case "media":
        field("schema", "schema");
        field("itemSchema", "schema");
        map("examples", "example");
        map("encoding", "encoding");
        list("prefixEncoding", "encoding");
        field("itemEncoding", "encoding");
        break;
      case "requestBody":
        map("content", "media");
        break;
      case "response":
        map("headers", "header");
        map("content", "media");
        map("links", "link");
        break;
      case "encoding":
        map("headers", "header");
        map("encoding", "encoding");
        list("prefixEncoding", "encoding");
        field("itemEncoding", "encoding");
        break;
      case "callback":
        for (const [key, value] of Object.entries(node))
          if (!key.startsWith("x-")) child(value, "path", "/" + esc(key));
        break;
      case "example":
        if (has(node, "externalValue"))
          externalValues.add(uriKey(absolute(node.externalValue, base)));
        break;
      case "schema":
        for (const name of schemaSingle)
          if (has(node, name)) child(node[name], "schema", "/" + name, false);
        for (const name of schemaLists)
          if (has(node, name)) {
            if (!Array.isArray(node[name])) fail("MODERN_SCHEMA_STRUCTURE");
            node[name].forEach((v, i) =>
              child(v, "schema", "/" + name + "/" + i, false),
            );
          }
        for (const name of schemaMaps)
          if (has(node, name)) {
            if (!object(node[name])) fail("MODERN_SCHEMA_STRUCTURE");
            for (const [key, value] of Object.entries(node[name]))
              child(value, "schema", "/" + name + "/" + esc(key), false);
          }
        break;
    }
  };
  index(entry.raw, "oad", entry);
  // This lightweight discovery pass only orders interpretation: it does not
  // publish aliases, validate business payloads, or mark anything as data.
  // An actual typed walk below must discover an Example.externalValue before
  // the target is treated as opaque. This makes grant insertion order inert.
  const possibleExampleTargets = (record) => {
    const targets = new Set();
    let base = record.retrievalURI;
    try {
      if (has(record.raw, "$self")) base = absolute(record.raw.$self, base);
    } catch {}
    const walk = (node, kind, depth = 0) => {
      if (!object(node) || depth > 64 || kind === "schema") return;
      const child = (value, type) => walk(value, type, depth + 1);
      const map = (name, type) => {
        if (object(node[name]))
          for (const [key, value] of Object.entries(node[name]))
            if (
              !(key.startsWith("x-") && ["paths", "responses"].includes(name))
            )
              child(value, type);
      };
      const list = (name, type) => {
        if (Array.isArray(node[name]))
          node[name].forEach((v) => child(v, type));
      };
      if (kind === "example") {
        if (typeof node.externalValue === "string")
          try {
            targets.add(absolute(node.externalValue, base).split("#")[0]);
          } catch {}
        return;
      }
      if (typeof node.$ref === "string" && kind !== "path") return;
      if (kind === "oad") {
        map("paths", "path");
        map("webhooks", "path");
        for (const [category, values] of Object.entries(
          object(node.components) ? node.components : {},
        ))
          if (Object.hasOwn(componentKinds, category) && object(values))
            for (const value of Object.values(values))
              child(value, componentKinds[category]);
      } else if (kind === "path") {
        for (const method of fixedMethods) child(node[method], "operation");
        map("additionalOperations", "operation");
        list("parameters", "parameter");
      } else if (kind === "operation") {
        list("parameters", "parameter");
        child(node.requestBody, "requestBody");
        map("responses", "response");
        map("callbacks", "callback");
      } else if (["parameter", "header", "media"].includes(kind)) {
        map("content", "media");
        map("examples", "example");
        map("encoding", "encoding");
        list("prefixEncoding", "encoding");
        child(node.itemEncoding, "encoding");
      } else if (kind === "requestBody") map("content", "media");
      else if (kind === "response") {
        map("headers", "header");
        map("content", "media");
      } else if (kind === "encoding") {
        map("headers", "header");
        map("encoding", "encoding");
        list("prefixEncoding", "encoding");
        child(node.itemEncoding, "encoding");
      } else if (kind === "callback")
        for (const [name, value] of Object.entries(node))
          if (!name.startsWith("x-")) child(value, "path");
    };
    walk(record.raw, "oad");
    return targets;
  };
  // Explicit bare-object grants are parsed in their reference context before
  // guessing standalone Schema resources. In particular a bare Example Object
  // can point to opaque XML/text that must never be parsed as a Schema.
  const indexFragments = () => {
    for (let i = 0; i < references.length; i++) {
      if (references.length > 4096) fail("MODERN_REFERENCE_BUDGET");
      const reference = references[i],
        address = absolute(reference.ref, reference.base),
        key = uriKey(address);
      if (indexed.has(key) || new URL(address).hash) continue;
      const record = documentsByURI.get(key);
      if (!record || record.isOAD || record.parseFailed || !object(record.raw))
        continue;
      if (record.fragmentKind && record.fragmentKind !== reference.kind)
        fail("MODERN_REFERENCE_TARGET_TYPE");
      record.fragmentKind = reference.kind;
      index(record.raw, reference.kind, record);
    }
  };
  indexFragments();
  const pendingOADs = records.filter((r) => r.isOAD && r !== entry);
  const possibleData = new Map(
    pendingOADs.map((record) => [record, possibleExampleTargets(record)]),
  );
  const semanticUse = (record) => {
    const targets = [
      ...semanticResourceURIs,
      ...references.map((r) => absolute(r.ref, r.base).split("#")[0]),
    ];
    for (const schema of new Set(schemaRegistry.values())) {
      if (!object(schema)) continue;
      for (const field of ["$ref", "$dynamicRef"])
        if (typeof schema[field] === "string")
          targets.push(
            absolute(
              schema[field],
              schemaLocations.get(schema)?.base ?? entry.documentURI,
            ).split("#")[0],
          );
    }
    return targets.some((target) => {
      const known = documentsByURI.get(uriKey(target));
      if (known) return known === record;
      if (!has(record.raw, "$self")) return false;
      try {
        return (
          absolute(record.raw.$self, record.retrievalURI).split("#")[0] ===
          target
        );
      } catch {
        return false;
      }
    });
  };
  while (pendingOADs.length) {
    const incoming = new Set(
      pendingOADs.flatMap((r) => [...possibleData.get(r)]),
    );
    let at = pendingOADs.findIndex(semanticUse);
    if (at < 0)
      at = pendingOADs.findIndex((r) => !incoming.has(r.retrievalURI));
    const record = pendingOADs.splice(Math.max(0, at), 1)[0];
    if (externalResource(record) && !semanticUse(record)) continue;
    activateIdentity(record);
    index(record.raw, "oad", record);
    indexFragments();
  }
  indexFragments();
  for (const record of records.filter((r) => !r.isOAD)) {
    if (
      record.fragmentKind ||
      externalResource(record) ||
      record.parseFailed ||
      (!object(record.raw) && typeof record.raw !== "boolean")
    )
      continue;
    index(record.raw, "schema", record);
  }

  const resolveTarget = (ref, base, kind) => {
    const uri = absolute(ref, base),
      address = uriKey(uri),
      found = indexed.get(address);
    if (found) {
      if (kind && found.kind !== kind) {
        if (
          !found.record.isOAD &&
          found.location.pointer === "" &&
          kind !== "schema" &&
          !found.record.fragmentKind
        ) {
          found.record.fragmentKind = kind;
          for (let i = schemaRoots.length - 1; i >= 0; i--)
            if (schemaRoots[i].schema === found.node) schemaRoots.splice(i, 1);
          for (const [key, value] of schemaRegistry)
            if (value === found.node) schemaRegistry.delete(key);
          schemaLocations.delete(found.node);
          index(found.node, kind, found.record);
          return indexed.get(address);
        }
        fail("MODERN_REFERENCE_TARGET_TYPE");
      }
      return found;
    }
    if (kind === "schema" && schemaRegistry.has(address))
      return {
        node: schemaRegistry.get(address),
        kind: "schema",
        location: { uri: address, base: address.split("#")[0] },
      };
    const record = documentsByURI.get(uriKey(uri.split("#")[0]));
    if (!record) fail("MODERN_REFERENCE_NOT_GRANTED");
    // A granted non-OAD fragment document is an explicit interoperability mode.
    // It is indexed as the referenced object type only when its root is used.
    const fragment = new URL(uri).hash.slice(1),
      decoded = fragment ? decodeURIComponent(fragment) : "";
    if (!record.isOAD && decoded === "" && kind !== "schema") {
      index(record.raw, kind, record);
      return indexed.get(address);
    }
    fail("MODERN_REFERENCE_TARGET_TYPE");
  };
  const resolved = new WeakMap(),
    active = new WeakSet(),
    resolvedNodes = new Set();
  const resolveObject = (node, kind) => {
    if (kind === "schema") return node;
    if (!object(node)) fail("MODERN_DOCUMENT_STRUCTURE");
    let memo = resolved.get(node);
    if (memo?.has(kind)) {
      if (active.has(node)) fail("MODERN_REFERENCE_CYCLE");
      return memo.get(kind);
    }
    if (!memo) {
      memo = new Map();
      resolved.set(node, memo);
    }
    const loc = locations.get(node);
    if (!loc) fail("MODERN_REFERENCE_TARGET_TYPE");
    active.add(node);
    const out = {};
    memo.set(kind, out);
    resolvedNodes.add(out);
    let sourceNode = node,
      sourceLocation = loc;
    if ((referenceKinds.has(kind) || kind === "path") && has(node, "$ref")) {
      const target = resolveTarget(node.$ref, loc.base, kind),
        reference = resolveObject(target.node, kind);
      for (const [key, value] of Object.entries(reference))
        setOwn(out, key, value);
      sourceLocation = target.location;
      if (kind !== "path") {
        for (const name of ["summary", "description"]) {
          const allowed =
            name === "summary"
              ? summaryKinds.has(kind) &&
                (kind !== "response" || entry.version.startsWith("3.2."))
              : descriptionKinds.has(kind);
          if (has(node, name) && allowed) {
            if (typeof node[name] !== "string")
              fail("MODERN_REFERENCE_ANNOTATION");
            setOwn(out, name, node[name]);
          }
        }
        locations.set(out, sourceLocation);
        active.delete(node);
        return out;
      }
      for (const key of Object.keys(node))
        if (key !== "$ref" && has(reference, key) && !key.startsWith("x-"))
          fail("MODERN_PATH_REFERENCE_CONFLICT");
      sourceNode = node;
    }
    locations.set(out, sourceLocation);
    const child = (v, childKind) => resolveObject(v, childKind);
    const mapValue = (v, childKind, extensions = false) => {
      if (!object(v)) fail("MODERN_DOCUMENT_STRUCTURE");
      const result = {};
      for (const [name, value] of Object.entries(v))
        setOwn(
          result,
          name,
          extensions && name.startsWith("x-")
            ? cloneExact(value)
            : child(value, childKind),
        );
      return result;
    };
    for (const [key, value] of Object.entries(sourceNode)) {
      if (kind === "path" && key === "$ref") continue;
      let transformed = value;
      if (key.startsWith("x-")) transformed = cloneExact(value);
      else if (kind === "oad") {
        if (["paths", "webhooks"].includes(key))
          transformed = mapValue(value, "path", key === "paths");
        else if (key === "components") {
          transformed = {};
          for (const [category, items] of Object.entries(value))
            setOwn(
              transformed,
              category,
              category.startsWith("x-")
                ? cloneExact(items)
                : mapValue(items, componentKinds[category]),
            );
        } else transformed = cloneExact(value);
      } else if (kind === "path") {
        if (fixedMethods.includes(key)) transformed = child(value, "operation");
        else if (key === "additionalOperations")
          transformed = mapValue(value, "operation");
        else if (key === "parameters")
          transformed = value.map((v) => child(v, "parameter"));
        else transformed = cloneExact(value);
      } else if (kind === "operation") {
        if (key === "parameters")
          transformed = value.map((v) => child(v, "parameter"));
        else if (key === "requestBody")
          transformed = child(value, "requestBody");
        else if (key === "responses")
          transformed = mapValue(value, "response", true);
        else if (key === "callbacks") transformed = mapValue(value, "callback");
        else transformed = cloneExact(value);
      } else if (["parameter", "header", "media"].includes(kind)) {
        if (["schema", "itemSchema"].includes(key)) transformed = value;
        else if (key === "content") transformed = mapValue(value, "media");
        else if (key === "examples") transformed = mapValue(value, "example");
        else if (key === "encoding") transformed = mapValue(value, "encoding");
        else if (key === "prefixEncoding")
          transformed = value.map((v) => child(v, "encoding"));
        else if (key === "itemEncoding") transformed = child(value, "encoding");
        else transformed = cloneExact(value);
      } else if (kind === "requestBody")
        transformed =
          key === "content" ? mapValue(value, "media") : cloneExact(value);
      else if (kind === "response")
        transformed =
          key === "content"
            ? mapValue(value, "media")
            : key === "headers"
              ? mapValue(value, "header")
              : key === "links"
                ? mapValue(value, "link")
                : cloneExact(value);
      else if (kind === "encoding")
        transformed =
          key === "headers"
            ? mapValue(value, "header")
            : key === "encoding"
              ? mapValue(value, "encoding")
              : key === "prefixEncoding"
                ? value.map((v) => child(v, "encoding"))
                : key === "itemEncoding"
                  ? child(value, "encoding")
                  : cloneExact(value);
      else if (kind === "callback") transformed = child(value, "path");
      else transformed = cloneExact(value);
      setOwn(out, key, transformed);
    }
    active.delete(node);
    return out;
  };
  for (const reference of references)
    resolveTarget(reference.ref, reference.base, reference.kind);
  const definition = resolveObject(entry.raw, "oad"),
    externalContexts = records
      .filter((r) => r.isOAD && r !== entry && locations.has(r.raw))
      .map((record) => ({
        definition: resolveObject(record.raw, "oad"),
        documentURI: record.documentURI,
        version: record.version,
      }));
  const effectiveSchemes = (context) => {
    const result = {};
    for (const [name, value] of Object.entries(
      context.components?.securitySchemes ?? {},
    ))
      setOwn(result, name, value);
    // Entry component names deliberately win for implicit multi-document links.
    for (const [name, value] of Object.entries(
      definition.components?.securitySchemes ?? {},
    ))
      setOwn(result, name, value);
    return result;
  };
  const operations = [],
    webhookOperations = [],
    operationCatalog = [],
    callbackOperations = new WeakMap(),
    operationRefs = new Map(),
    operationIds = new Map(),
    allIds = new Map();
  const explicitIds = new Map();
  for (const op of resolvedNodes) {
    if (locations.get(op).kind !== "operation" || !has(op, "operationId"))
      continue;
    if (typeof op.operationId !== "string" || op.operationId.length > 256)
      fail("MODERN_OPERATION_ID");
    const prior = explicitIds.get(op.operationId);
    if (prior && prior !== op) fail("MODERN_DUPLICATE_OPERATION");
    explicitIds.set(op.operationId, op);
  }
  const parameters = (item, op) => {
    const merged = new Map();
    for (const list of [item.parameters ?? [], op.parameters ?? []]) {
      if (!Array.isArray(list)) fail("MODERN_PARAMETER_LIST");
      const seen = new Set();
      for (const p of list) {
        const key =
          p.in + ":" + (p.in === "header" ? p.name?.toLowerCase() : p.name);
        if (seen.has(key)) fail("MODERN_DUPLICATE_PARAMETER");
        seen.add(key);
        merged.set(key, p);
      }
    }
    const list = [...merged.values()];
    if (
      list.filter((p) => p.in === "querystring").length > 1 ||
      (list.some((p) => p.in === "querystring") &&
        list.some((p) => p.in === "query"))
    )
      fail("MODERN_QUERYSTRING_CONFLICT");
    return list.filter(
      (p) =>
        !(
          p.in === "header" &&
          ["accept", "content-type", "authorization"].includes(
            p.name.toLowerCase(),
          )
        ),
    );
  };
  const security = (op, context) => {
    const schemes = effectiveSchemes(context);
    const owner = has(op, "security") ? op : context;
    const ownerLocation = locations.get(owner);
    const ownerVersion = ownerLocation?.record.version ?? context.openapi;
    for (const requirement of owner.security ?? [])
      for (const [name, roles] of Object.entries(requirement)) {
        if (!has(schemes, name)) {
          if (!ownerVersion.startsWith("3.2."))
            fail("MODERN_SECURITY_REQUIREMENT");
          const target = resolveTarget(
            name,
            ownerLocation?.base ?? entry.documentURI,
            "security",
          );
          setOwn(schemes, name, resolveObject(target.node, "security"));
        }
        if (!Array.isArray(roles) || roles.some((r) => typeof r !== "string"))
          fail("MODERN_SECURITY_REQUIREMENT");
        if (
          ownerVersion.startsWith("3.1.") &&
          !["oauth2", "openIdConnect"].includes(schemes[name].type) &&
          roles.length
        )
          fail("MODERN_SECURITY_REQUIREMENT");
      }
    return schemes;
  };
  const visitPath = (route, item, zone, context, output) => {
    const version = context.openapi;
    for (const { method, key, op } of modernMethods(item, version)) {
      if (!object(op)) fail("MODERN_OPERATION");
      const nodeURI = locations.get(op)?.uri ?? entry.documentURI;
      const suffix = createHash("sha256")
        .update(nodeURI)
        .digest("hex")
        .slice(0, 16);
      let defaultID =
        zone === "paths" && context === definition
          ? method + " " + route
          : zone +
            ":" +
            suffix +
            ":" +
            method +
            " " +
            (route ?? "").slice(0, 180);
      // Generated tool IDs are not OAS operationIds and must neither satisfy
      // Link.operationId nor collide with a real explicit OAS identifier.
      const ordinaryDefaultID = defaultID;
      for (let attempt = 0; explicitIds.has(defaultID); attempt++)
        defaultID =
          "@moonapi:" +
          suffix +
          ":" +
          attempt +
          ":" +
          ordinaryDefaultID.slice(0, 180);
      const id = op.operationId || defaultID;
      if (typeof id !== "string" || !id || id.length > 256)
        fail("MODERN_OPERATION_ID");
      const prior = allIds.get(id);
      if (prior && prior !== op) fail("MODERN_DUPLICATE_OPERATION");
      allIds.set(id, op);
      const allParameters = parameters(item, op),
        loc = locations.get(op);
      if (zone === "paths") {
        const names = [...route.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]);
        if (
          new Set(names).size !== names.length ||
          /[{}]/.test(route.replace(/\{[^{}]+\}/g, ""))
        )
          fail("MODERN_PATH_TEMPLATE");
        if (
          names.some(
            (name) =>
              !allParameters.some(
                (p) =>
                  p.in === "path" && p.name === name && p.required === true,
              ),
          ) ||
          allParameters.some((p) => p.in === "path" && !names.includes(p.name))
        )
          fail("MODERN_PATH_PARAMETER");
      }
      const record = {
        id,
        method,
        key,
        op,
        item,
        route,
        zone,
        context,
        documentURI: loc?.documentURI ?? entry.documentURI,
        baseURI: loc?.base ?? entry.documentURI,
        allParameters,
        securitySchemes: security(op, context),
        uri: loc?.uri,
        bound: zone === "paths" && context === definition,
        dispatchable: zone === "paths" && context === definition,
      };
      output.push(record);
      operationCatalog.push(record);
      // A reusable Operation may also be bound at an entry-document path. Its
      // real route takes precedence over an auxiliary component/callback view.
      // Never synthesize an HTTP path from a Components Object property name.
      if (loc) {
        const prior = operationRefs.get(uriKey(loc.uri));
        if (!prior || (!prior.bound && record.bound))
          operationRefs.set(uriKey(loc.uri), record);
      }
      if (has(op, "operationId")) {
        const priorID = operationIds.get(op.operationId);
        if (!priorID || (!priorID.bound && record.bound))
          operationIds.set(op.operationId, record);
      }
      for (const [name, cb] of Object.entries(op.callbacks ?? {})) {
        const collected = [];
        for (const [expression, path] of Object.entries(cb))
          if (!expression.startsWith("x-"))
            visitPath(expression, path, "callbacks", context, collected);
        callbackOperations.set(cb, collected);
      }
      if (
        operations.length + webhookOperations.length > 256 ||
        allIds.size > 1024
      )
        fail("MODERN_OPERATION_BUDGET");
    }
  };
  for (const context of [
    definition,
    ...externalContexts.map((c) => c.definition),
  ]) {
    // Security requirements are normative declarations even when an OAD has no
    // executable paths, or every operation overrides the root declaration.
    security(context, context);
    const routes = new Set();
    for (const [route, item] of Object.entries(context.paths ?? {})) {
      if (route.startsWith("x-")) continue;
      if (!route.startsWith("/") || /[?#]/.test(route))
        fail("MODERN_PATH_TEMPLATE");
      const shape = route.replace(/\{[^{}]+\}/g, "{}");
      if (routes.has(shape)) fail("MODERN_PATH_TEMPLATE_DUPLICATE");
      routes.add(shape);
      visitPath(
        route,
        item,
        "paths",
        context,
        context === definition ? operations : [],
      );
    }
    for (const [name, item] of Object.entries(context.webhooks ?? {}))
      visitPath(
        name,
        item,
        "webhooks",
        context,
        context === definition ? webhookOperations : [],
      );
    for (const item of Object.values(context.components?.pathItems ?? {}))
      visitPath(undefined, item, "components", context, []);
    for (const cb of Object.values(context.components?.callbacks ?? {})) {
      const collected = [];
      for (const [expression, path] of Object.entries(cb))
        if (!expression.startsWith("x-"))
          visitPath(expression, path, "callbacks", context, collected);
      callbackOperations.set(cb, collected);
    }
  }
  const semantic = (node, kind) => {
    if (kind === "schema" || !object(node)) return;
    const modern32 = (
      locations.get(node)?.record.version ?? entry.version
    ).startsWith("3.2.");
    if (["parameter", "header"].includes(kind)) {
      if (has(node, "schema") === has(node, "content"))
        fail("MODERN_PARAMETER_SCHEMA_CONTENT");
      if (has(node, "content") && Object.keys(node.content).length !== 1)
        fail("MODERN_PARAMETER_CONTENT");
      if (has(node, "example") && has(node, "examples"))
        fail("MODERN_EXAMPLE_CONFLICT");
      if (
        node.in === "querystring" &&
        (!has(node, "content") ||
          !modern32 ||
          ["schema", "style", "explode", "allowReserved"].some((k) =>
            has(node, k),
          ))
      )
        fail("MODERN_QUERYSTRING_CONTENT");
      if (has(node, "allowEmptyValue") && node.in !== "query")
        fail("MODERN_PARAMETER_ALLOW_EMPTY");
      if (
        kind === "header" &&
        (has(node, "name") ||
          has(node, "in") ||
          has(node, "allowEmptyValue") ||
          (!modern32 && has(node, "allowReserved")))
      )
        fail("MODERN_HEADER_FIELDS");
      const styles = {
        path: ["simple", "label", "matrix"],
        query: ["form", "spaceDelimited", "pipeDelimited", "deepObject"],
        header: ["simple"],
        cookie: ["form", "cookie"],
      };
      if (
        has(node, "schema") &&
        node.style &&
        !(styles[node.in ?? "header"] ?? []).includes(node.style)
      )
        fail("MODERN_PARAMETER_STYLE");
      if (
        (!modern32 && node.style === "cookie") ||
        (modern32 &&
          node.in === "cookie" &&
          has(node, "schema") &&
          node.explode === false)
      )
        fail("MODERN_COOKIE_SERIALIZATION");
    }
    if (
      kind === "operation" &&
      has(node, "responses") &&
      !Object.keys(node.responses).some((k) => !k.startsWith("x-"))
    )
      fail("MODERN_RESPONSES_EMPTY");
    if (kind === "example") {
      if (
        (has(node, "value") &&
          ["externalValue", "dataValue", "serializedValue"].some((k) =>
            has(node, k),
          )) ||
        (has(node, "serializedValue") && has(node, "externalValue"))
      )
        fail("MODERN_EXAMPLE_CONFLICT");
    }
    if (
      ["media", "encoding"].includes(kind) &&
      has(node, "encoding") &&
      (has(node, "prefixEncoding") || has(node, "itemEncoding"))
    )
      fail("MODERN_ENCODING_CONFLICT");
    if (kind === "media" && has(node, "example") && has(node, "examples"))
      fail("MODERN_EXAMPLE_CONFLICT");
    if (kind === "link") {
      if (has(node, "operationId") === has(node, "operationRef"))
        fail("MODERN_LINK_TARGET");
      if (has(node, "operationId") && !explicitIds.has(node.operationId))
        fail("MODERN_LINK_OPERATION");
      if (has(node, "operationRef"))
        resolveTarget(
          node.operationRef,
          locations.get(node)?.base ?? entry.documentURI,
          "operation",
        );
    }
  };
  for (const node of resolvedNodes) semantic(node, locations.get(node).kind);
  const serversAndTags = (context) => {
    for (const node of resolvedNodes) {
      if (
        ["oad", "path", "operation"].includes(locations.get(node).kind) &&
        has(node, "servers")
      ) {
        if (!Array.isArray(node.servers)) fail("MODERN_SERVER_STRUCTURE");
        const names = new Set();
        for (const s of node.servers) {
          if (!object(s) || typeof s.url !== "string")
            fail("MODERN_SERVER_STRUCTURE");
          if (s.name !== undefined && names.has(s.name))
            fail("MODERN_SERVER_NAME");
          if (s.name !== undefined) names.add(s.name);
          for (const match of s.url.matchAll(/\{([^{}]+)\}/g))
            if (!has(s.variables ?? {}, match[1]))
              fail("MODERN_SERVER_VARIABLE");
          for (const v of Object.values(s.variables ?? {}))
            if (v.enum && (!v.enum.length || !v.enum.includes(v.default)))
              fail("MODERN_SERVER_VARIABLE_ENUM");
        }
      }
    }
    const tags = new Map();
    for (const tag of context.tags ?? []) {
      if (tags.has(tag.name)) fail("MODERN_TAG_DUPLICATE");
      tags.set(tag.name, tag);
    }
    for (const tag of tags.values()) {
      const chain = new Set([tag.name]);
      let parent = tag.parent;
      while (parent !== undefined) {
        if (!tags.has(parent) || chain.has(parent)) fail("MODERN_TAG_PARENT");
        chain.add(parent);
        parent = tags.get(parent).parent;
      }
    }
    if (
      has(context.info?.license ?? {}, "identifier") &&
      has(context.info.license, "url")
    )
      fail("MODERN_LICENSE_CONFLICT");
  };
  serversAndTags(definition);
  externalContexts.forEach((c) => serversAndTags(c.definition));

  // Structural types inspect only OAS objects; a JSON Schema dialect is not a
  // 3.0 Schema Object and must not be constrained by a linter's schema subset.
  const structuralMapKinds = {
    pathMap: "path",
    pathsMap: "path",
    responsesMap: "response",
    parameterMap: "parameter",
    headerMap: "header",
    requestBodyMap: "requestBody",
    responseMap: "response",
    exampleMap: "example",
    linkMap: "link",
    callbackMap: "callback",
    securityMap: "security",
    mediaMap: "media",
    encodingMap: "encoding",
    operationMap: "operation",
    serverVariableMap: "serverVariable",
  };
  const structuralFieldKind = (kind, key) => {
    if (kind === "oad")
      return {
        paths: "pathsMap",
        webhooks: "pathMap",
        components: "components",
        servers: "serverList",
        security: "securityList",
      }[key];
    if (kind === "components")
      return key === "schemas"
        ? "schemaMap"
        : componentKinds[key]
          ? componentKinds[key] + "Map"
          : undefined;
    if (kind === "path")
      return { additionalOperations: "operationMap", servers: "serverList" }[
        key
      ];
    if (kind === "operation")
      return {
        responses: "responsesMap",
        callbacks: "callbackMap",
        servers: "serverList",
        security: "securityList",
      }[key];
    if (
      [
        "parameter",
        "header",
        "media",
        "requestBody",
        "response",
        "encoding",
      ].includes(kind)
    ) {
      if (key === "content") return "mediaMap";
      if (key === "examples") return "exampleMap";
      if (key === "headers") return "headerMap";
      if (key === "links") return "linkMap";
      if (key === "encoding") return "encodingMap";
    }
    if (kind === "security" && key === "flows") return "oauthFlows";
    if (kind === "oauthFlows" && !key.startsWith("x-")) return "oauthFlow";
    if (kind === "oauthFlow" && key === "scopes") return "stringMap";
    if (kind === "server" && key === "variables") return "serverVariableMap";
    if (kind === "link" && key === "parameters") return "opaqueMap";
    if (kind === "link" && key === "server") return "server";
    return undefined;
  };
  const structural = (node, kind) => {
    if (kind === "schema") return {};
    if (!node || typeof node !== "object" || numeric(node)) return shadow(node);
    if (Array.isArray(node))
      return node.map((v) =>
        structural(
          v,
          kind === "securityList"
            ? "securityRequirement"
            : kind === "serverList"
              ? "server"
              : locations.get(v)?.kind,
        ),
      );
    const out = {};
    for (const [k, value] of Object.entries(node)) {
      if (k === "hasOwnProperty") {
        setOwn(
          out,
          kind ? "moonapi-unexpected-own-name" : "moonapi-own-name",
          structural(value, locations.get(value)?.kind),
        );
        continue;
      }
      if (kind === "schemaMap") setOwn(out, k, {});
      else if (kind === "opaqueMap") setOwn(out, k, null);
      else if (kind === "securityRequirement" || kind === "stringMap")
        setOwn(out, k, structural(value));
      else if (structuralMapKinds[kind])
        setOwn(
          out,
          k,
          k.startsWith("x-") && ["pathsMap", "responsesMap"].includes(kind)
            ? null
            : structural(value, structuralMapKinds[kind]),
        );
      else if (
        k.startsWith("x-") ||
        (["parameter", "header", "media"].includes(kind) && k === "example") ||
        (kind === "example" && ["value", "dataValue"].includes(k)) ||
        (kind === "link" && k === "requestBody")
      )
        setOwn(out, k, null);
      else if (
        schemaLocations.has(value) ||
        (typeof value === "boolean" && ["schema", "itemSchema"].includes(k))
      )
        setOwn(out, k, {});
      else
        setOwn(
          out,
          k,
          structural(
            value,
            structuralFieldKind(kind, k) ?? locations.get(value)?.kind,
          ),
        );
    }
    // Redocly's inherited Struct visitor calls node.hasOwnProperty directly.
    // This opaque non-enumerable function preserves legal own business keys.
    if (!has(out, "hasOwnProperty"))
      Object.defineProperty(out, "hasOwnProperty", {
        value: Object.prototype.hasOwnProperty,
      });
    return out;
  };
  class NoAmbientResolver extends BaseResolver {
    async loadExternalRef() {
      fail("MODERN_REFERENCE_NOT_GRANTED");
    }
  }
  const config = await createConfig({ rules: { struct: "error" } });
  for (const context of [
    definition,
    ...externalContexts.map((c) => c.definition),
  ]) {
    const versionTypes = context.openapi.startsWith("3.2.")
      ? Oas3_2Types
      : Oas3_1Types;
    const customTypes = {
      ...versionTypes,
      Schema: { properties: {}, additionalProperties: null },
      NamedMediaTypes: { properties: {}, additionalProperties: "MediaType" },
    };
    // Normative3.2 additions omitted from the dependency's inherited tables.
    if (context.openapi.startsWith("3.2.")) {
      customTypes.Response = { ...versionTypes.Response, required: [] };
      customTypes.Parameter = {
        ...versionTypes.Parameter,
        properties: {
          ...versionTypes.Parameter.properties,
          style: {
            enum: [
              "form",
              "simple",
              "label",
              "matrix",
              "spaceDelimited",
              "pipeDelimited",
              "deepObject",
              "cookie",
            ],
          },
        },
      };
      customTypes.EncodingMap = {
        properties: {},
        additionalProperties: "Encoding",
      };
      customTypes.Encoding = {
        ...versionTypes.Encoding,
        properties: {
          ...versionTypes.Encoding.properties,
          encoding: "EncodingMap",
          prefixEncoding: {
            name: "PrefixEncoding",
            properties: {},
            items: "Encoding",
          },
          itemEncoding: "Encoding",
        },
      };
    }
    const problems = await lintDocument({
      document: {
        source: new Source(
          locations.get(context)?.documentURI ?? entry.documentURI,
          "",
        ),
        parsed: structural(context, "oad"),
      },
      config,
      customTypes,
      externalRefResolver: new NoAmbientResolver(),
    });
    if (problems.some((p) => p.severity === "error"))
      fail("MODERN_DOCUMENT_STRUCTURE");
  }
  return {
    definition,
    version: entry.version,
    defaultDialect:
      entry.raw.jsonSchemaDialect !== undefined
        ? absolute(entry.raw.jsonSchemaDialect, entry.documentURI)
        : defaultModernDialect(entry.version),
    documentURI: entry.documentURI,
    retrievalURI: retrieval,
    schemaRegistry: new Map(
      [...schemaRegistry].map(([key, value]) => [
        externalRegistryURI(key),
        value,
      ]),
    ),
    schemaLocations,
    schemaRoots,
    locations,
    operations,
    operationCatalog,
    webhookOperations,
    callbackOperations,
    externalContexts,
    references,
    resolve: (ref, base = entry.documentURI, kind) => {
      const target = resolveTarget(ref, base, kind);
      return kind === "schema" || target.kind === "schema"
        ? target.node
        : resolveObject(target.node, kind ?? target.kind);
    },
    resolveOperationRef: (ref, base = entry.documentURI) => {
      const target = resolveTarget(ref, base, "operation");
      return operationRefs.get(uriKey(target.location.uri));
    },
    resolveOperationId: (id) => operationIds.get(id),
    contextSchemes: effectiveSchemes,
    schemaDocuments: Object.fromEntries(
      records
        .filter(
          (r) =>
            !r.isOAD &&
            !r.fragmentKind &&
            !r.parseFailed &&
            !externalValues.has(uriKey(r.retrievalURI)) &&
            (object(r.raw) || typeof r.raw === "boolean"),
        )
        .map((r) => [r.documentURI, r.raw]),
    ),
    resources: new Map(
      [...documentsByURI].map(([key, record]) => [
        externalRegistryURI(key),
        record.text,
      ]),
    ),
    resourceText: (ref, base = entry.documentURI) =>
      documentsByURI.get(uriKey(absolute(ref, base)))?.text,
    reference_policy:
      "explicit_document_map_only; entry_component_names_first; conflicting_path_ref_siblings_rejected",
  };
}

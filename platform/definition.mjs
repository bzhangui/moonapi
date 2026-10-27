// One lossless JSON/YAML boundary for inspection, project import and CI diff.
// It deliberately does not apply OAS 3.0 $ref sibling rules to other dialects.
import { parseDocument, isMap, isSeq, isScalar, isAlias } from "yaml";
import { number, setOwn, numeric, stringifyExact } from "./standard-value.mjs";
export function parseDefinition(source) {
  if (typeof source !== "string" || Buffer.byteLength(source) > 1048576)
    throw new Error("DEFINITION_BUDGET");
  const doc = parseDocument(source, {
    version: "1.2",
    schema: "core",
    uniqueKeys: true,
    prettyErrors: false,
  });
  if (doc.errors.length || doc.warnings.length)
    throw new Error("DEFINITION_ENCODING");
  try {
    doc.toJS({ maxAliasCount: 20 });
  } catch {
    throw new Error("DEFINITION_ALIAS_BUDGET");
  }
  let count = 0;
  function visit(node, parents = new Set()) {
    if (++count > 50000 || parents.size > 64)
      throw new Error("DEFINITION_BUDGET");
    if (isAlias(node)) {
      if (parents.has(node)) throw new Error("DEFINITION_CYCLE");
      return visit(node.resolve(doc), new Set(parents).add(node));
    }
    const next = new Set(parents).add(node);
    if (isMap(node)) {
      const value = {};
      for (const p of node.items) {
        if (!isScalar(p.key) || typeof p.key.value !== "string")
          throw new Error("DEFINITION_KEY");
        setOwn(value, p.key.value, visit(p.value, next));
      }
      return value;
    }
    if (isSeq(node)) return node.items.map((x) => visit(x, next));
    if (isScalar(node) && typeof node.value === "number") {
      let s = node.source.replace(/^\+/, "");
      if (/^-?0[xo][0-9a-f]+$/i.test(s)) {
        const neg = s.startsWith("-");
        s = String((neg ? -1n : 1n) * BigInt(neg ? s.slice(1) : s));
      }
      try {
        return number(
          s.replace(/^(-?)\./, "$10.").replace(/\.(?=[eE]|$)/, ".0"),
        );
      } catch {
        throw new Error("DEFINITION_NUMBER");
      }
    }
    return node?.value ?? null;
  }
  return visit(doc.contents);
}
export function canonicalDefinition(value) {
  const sort = (v) =>
    !v || typeof v !== "object" || numeric(v)
      ? v
      : Array.isArray(v)
        ? v.map(sort)
        : Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, sort(v[k])]),
          );
  return stringifyExact(sort(value));
}

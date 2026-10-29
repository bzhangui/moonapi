// Bounded candidates, not a claim that arbitrary satisfiability is decidable.
// Every accepted candidate is checked by the native modern dialect evaluator.
import RandExp from "randexp";
import { compileExactModern } from "./modern-exact.mjs";
import { specializeModernResources } from "./modern-resources.mjs";
import {
  cloneExact,
  numeric,
  decimal,
  compare,
  number,
  setOwn,
} from "./standard-value.mjs";
const own = (o, k) => Object.hasOwn(o, k);
const count = (n, cap) =>
  n === undefined ? 0 : Math.min(cap, Number(String(n)));
export function modernSchemaTools(prepared) {
  const validators = new WeakMap(),
    graphs = new WeakMap();
  const options = (s) => ({
    schemaRegistry: prepared.schemaRegistry,
    schemaDialects: prepared.schemaLocations,
    rootURI: prepared.schemaLocations.get(s)?.uri ?? prepared.documentURI + "#",
    dialect:
      prepared.schemaLocations.get(s)?.dialect ??
      prepared.definition.jsonSchemaDialect ??
      prepared.defaultDialect,
  });
  const validator = (s) => {
    while (s && typeof s === "object" && derived.has(s)) s = derived.get(s);
    if (s === undefined) return () => ({ valid: true });
    if (typeof s === "boolean") return compileExactModern(s, {}, options(s));
    if (!validators.has(s))
      validators.set(
        s,
        compileExactModern(
          prepared.schemaLocations.has(s) ? s : rebase(s),
          {},
          options(s),
        ),
      );
    return validators.get(s);
  };
  const validate = (s, v) => validator(s)(v).valid;
  const graph = (s) => {
    if (typeof s === "boolean") return { schema: s, documents: {} };
    if (!graphs.has(s))
      graphs.set(s, specializeModernResources(s, {}, options(s)));
    return graphs.get(s);
  };
  const rootName = (s) => {
    let target = s;
    const visited = new Set();
    while (
      target &&
      typeof target === "object" &&
      target.$ref &&
      !visited.has(target)
    ) {
      visited.add(target);
      const loc = prepared.schemaLocations.get(target);
      try {
        target = prepared.resolve(
          target.$ref,
          loc?.base ?? prepared.documentURI,
          "schema",
        );
      } catch {
        break;
      }
    }
    const pointer = prepared.schemaLocations.get(target)?.pointer ?? "",
      m = /^\/components\/schemas\/([^/]+)$/.exec(pointer);
    return m?.[1].replace(/~1/g, "/").replace(/~0/g, "~");
  };
  const derived = new WeakMap();
  const rebase = (raw) => {
    if (!raw || typeof raw !== "object") return raw;
    while (derived.has(raw)) raw = derived.get(raw);
    const loc = prepared.schemaLocations.get(raw);
    if (loc) return { $ref: loc.uri };
    const out = { ...raw };
    for (const k of [
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
    ])
      if (own(out, k)) out[k] = rebase(out[k]);
    for (const k of ["allOf", "anyOf", "oneOf", "prefixItems"])
      if (Array.isArray(out[k])) out[k] = out[k].map(rebase);
    for (const k of [
      "$defs",
      "properties",
      "patternProperties",
      "dependentSchemas",
    ])
      if (out[k])
        out[k] = Object.fromEntries(
          Object.entries(out[k]).map(([n, v]) => [n, rebase(v)]),
        );
    return out;
  };
  const shape = (s, value) => {
    while (s && typeof s === "object" && derived.has(s)) s = derived.get(s);
    if (s === undefined || s === true || s === false)
      return s === false ? false : {};
    const seen = new Set();
    const view = (raw, actual, depth = 0) => {
      if (!raw || typeof raw !== "object" || depth > 32 || seen.has(raw))
        return {};
      seen.add(raw);
      const out = { ...raw };
      delete out.$ref;
      delete out.$dynamicRef;
      const merge = (child) => {
        for (const [k, v] of Object.entries(child)) {
          if (["properties", "patternProperties"].includes(k)) {
            const fields = { ...(out[k] ?? {}) };
            for (const [name, sub] of Object.entries(v))
              setOwn(
                fields,
                name,
                own(fields, name) ? { allOf: [fields[name], sub] } : sub,
              );
            out[k] = fields;
          } else if (k === "required")
            out.required = [...new Set([...(out.required ?? []), ...v])];
          else if (k === "type" && out.type !== undefined) {
            const left = Array.isArray(out.type) ? out.type : [out.type],
              right = Array.isArray(v) ? v : [v];
            const types = [
              ...new Set(
                left.flatMap((x) =>
                  right.flatMap((y) =>
                    x === y
                      ? [x]
                      : [x, y].every((t) => ["number", "integer"].includes(t))
                        ? ["integer"]
                        : [],
                  ),
                ),
              ),
            ];
            out.type = types.length === 1 ? types[0] : types;
          } else if (out[k] === undefined) setOwn(out, k, v);
        }
      };
      for (const ref of [raw.$ref, raw.$dynamicRef])
        if (ref) {
          const location = prepared.schemaLocations.get(raw);
          merge(
            view(
              prepared.resolve(
                ref,
                location?.base ?? prepared.documentURI,
                "schema",
              ),
              actual,
              depth + 1,
            ),
          );
        }
      for (const child of raw.allOf ?? [])
        merge(view(child, actual, depth + 1));
      if (raw.if !== undefined && actual !== undefined) {
        const passed = validate(raw.if, actual),
          active = passed ? raw.then : raw.else;
        if (passed) merge(view(raw.if, actual, depth + 1));
        if (active !== undefined) merge(view(active, actual, depth + 1));
      }
      if (actual && typeof actual === "object")
        for (const [key, child] of Object.entries(raw.dependentSchemas ?? {}))
          if (own(actual, key)) merge(view(child, actual, depth + 1));
      for (const keyword of ["oneOf", "anyOf"])
        if (raw[keyword]?.length) {
          const choices = raw[keyword].filter((child) =>
            actual !== undefined
              ? validate(child, actual)
              : raw[keyword].length === 1,
          );
          if (choices.length === 1) merge(view(choices[0], actual, depth + 1));
        }
      for (const key of ["items", "contains", "additionalProperties"])
        if (out[key] && typeof out[key] === "object")
          out[key] = view(out[key], undefined, depth + 1);
      for (const key of ["properties", "patternProperties"])
        if (out[key])
          out[key] = Object.fromEntries(
            Object.entries(out[key]).map(([name, child]) => [
              name,
              view(
                child,
                actual && typeof actual === "object" ? actual[name] : undefined,
                depth + 1,
              ),
            ]),
          );
      if (out.prefixItems)
        out.prefixItems = out.prefixItems.map((child, i) =>
          view(child, Array.isArray(actual) ? actual[i] : undefined, depth + 1),
        );
      const types = Array.isArray(out.type) ? out.type : null;
      if (types && actual !== undefined)
        out.type =
          types.find(
            (t) =>
              t ===
                (actual === null
                  ? "null"
                  : Array.isArray(actual)
                    ? "array"
                    : numeric(actual)
                      ? "number"
                      : typeof actual) ||
              (t === "integer" && numeric(actual) && decimal(actual)[1] >= 0),
          ) ?? types;
      derived.set(out, raw);
      seen.delete(raw);
      return out;
    };
    const result = view(s, value),
      name = rootName(s);
    if (name && !result.xml?.name) result.xml = { ...(result.xml ?? {}), name };
    return result;
  };
  const sample = (s, examples = [], seed = 42) => {
    if (s === undefined)
      return examples.find((v) => v !== undefined) ?? "sample";
    for (const v of examples)
      if (v !== undefined && validate(s, v)) return cloneExact(v);
    const g = graph(s);
    let generated = 0;
    const deref = (r, seen = new Set()) => {
      if (!r?.$ref || seen.has(r.$ref)) return r;
      return {
        ...deref(g.documents[r.$ref], new Set(seen).add(r.$ref)),
        ...Object.fromEntries(Object.entries(r).filter(([k]) => k !== "$ref")),
      };
    };
    const combine = (a, b) => {
      const out = {
        ...a,
        ...b,
        properties: { ...(a.properties ?? {}) },
        required: [...new Set([...(a.required ?? []), ...(b.required ?? [])])],
      };
      for (const [k, v] of Object.entries(b.properties ?? {}))
        setOwn(
          out.properties,
          k,
          own(out.properties, k) ? { allOf: [out.properties[k], v] } : v,
        );
      for (const key of [
        "minimum",
        "exclusiveMinimum",
        "minLength",
        "minItems",
        "minProperties",
        "minContains",
      ])
        if (a[key] !== undefined && b[key] !== undefined)
          out[key] = compare(a[key], b[key]) > 0 ? a[key] : b[key];
      for (const key of [
        "maximum",
        "exclusiveMaximum",
        "maxLength",
        "maxItems",
        "maxProperties",
        "maxContains",
      ])
        if (a[key] !== undefined && b[key] !== undefined)
          out[key] = compare(a[key], b[key]) < 0 ? a[key] : b[key];
      if (a.type !== undefined && b.type !== undefined) {
        const left = Array.isArray(a.type) ? a.type : [a.type],
          right = Array.isArray(b.type) ? b.type : [b.type];
        out.type = [
          ...new Set(
            left.flatMap((x) =>
              right.flatMap((y) =>
                x === y
                  ? [x]
                  : [x, y].every((v) => ["number", "integer"].includes(v))
                    ? ["integer"]
                    : [],
              ),
            ),
          ),
        ];
        if (out.type.length === 1) out.type = out.type[0];
      }
      return out;
    };
    const make = (raw, n, depth = 0, seen = new Set()) => {
      if (++generated > 20000 || depth > 14 || raw === false) return undefined;
      if (raw === true || raw === undefined) return n % 2 ? "sample" : null;
      if (raw.$ref && seen.has(raw.$ref)) return undefined;
      const next = new Set(seen);
      if (raw.$ref) next.add(raw.$ref);
      const r = deref(raw);
      for (const v of [
        r.const,
        ...(r.enum ?? []).slice(n % (r.enum?.length || 1)),
        ...(Array.isArray(r.examples) ? r.examples : []),
        r.example,
        r.default,
      ])
        if (v !== undefined) return cloneExact(v);
      let merged = {
        ...r,
        properties: { ...(r.properties ?? {}) },
        required: [...(r.required ?? [])],
      };
      const branches = [
        ...(r.allOf ?? []),
        ...((r.oneOf ?? r.anyOf)?.length
          ? [(r.oneOf ?? r.anyOf)[n % (r.oneOf ?? r.anyOf).length]]
          : []),
        ...(r.if
          ? [n % 2 ? r.then : r.else].filter((v) => v !== undefined)
          : []),
      ];
      for (const b of branches) {
        const p = deref(b);
        if (p && typeof p === "object") {
          merged = combine(merged, p);
        }
      }
      const activeKeys = new Set([
        ...merged.required,
        ...Object.keys(merged.properties).filter((_k, i) => n % 2 || i < 4),
      ]);
      for (const [key, sub] of Object.entries(merged.dependentSchemas ?? {}))
        if (activeKeys.has(key)) {
          const p = deref(sub);
          if (p && typeof p === "object") merged = combine(merged, p);
        }
      if (merged.const !== undefined) return cloneExact(merged.const);
      if (merged.enum?.length)
        return cloneExact(merged.enum[n % merged.enum.length]);
      if (Array.isArray(merged.type) && !merged.type.length) return undefined;
      let t = Array.isArray(merged.type)
        ? merged.type[n % merged.type.length]
        : merged.type;
      t ??=
        Object.keys(merged.properties).length ||
        merged.required.length ||
        merged.dependentRequired
          ? "object"
          : merged.items || merged.prefixItems || merged.contains
            ? "array"
            : ["minimum", "maximum", "exclusiveMinimum", "multipleOf"].some(
                  (k) => own(merged, k),
                )
              ? "number"
              : "string";
      if (t === "null") return null;
      if (t === "boolean") return !!(n % 2);
      if (t === "number" || t === "integer") {
        const lower =
            merged.minimum === undefined
              ? merged.exclusiveMinimum
              : merged.exclusiveMinimum === undefined
                ? merged.minimum
                : compare(merged.minimum, merged.exclusiveMinimum) > 0
                  ? merged.minimum
                  : merged.exclusiveMinimum,
          upper =
            merged.maximum === undefined
              ? merged.exclusiveMaximum
              : merged.exclusiveMaximum === undefined
                ? merged.maximum
                : compare(merged.maximum, merged.exclusiveMaximum) < 0
                  ? merged.maximum
                  : merged.exclusiveMaximum;
        let step = merged.multipleOf ?? (t === "integer" ? 1 : number("0.1"));
        if (t === "integer") {
          const [a, e] = decimal(step);
          if (e < 0) {
            let x = a,
              y = 10n ** BigInt(-e);
            while (y) {
              const z = x % y;
              x = y;
              y = z;
            }
            step = number(String(a / x));
          }
        }
        const candidate = lower ?? upper ?? 0,
          [x, e] = decimal(candidate),
          [a, f] = decimal(step),
          z = Math.min(e, f),
          value = x * 10n ** BigInt(e - z),
          unit = a * 10n ** BigInt(f - z);
        let q = value / unit;
        const up = lower !== undefined || upper === undefined;
        if ((up && value % unit > 0n) || (!up && value % unit < 0n))
          q += up ? 1n : -1n;
        if (
          value % unit === 0n &&
          (up
            ? merged.exclusiveMinimum !== undefined &&
              compare(candidate, merged.exclusiveMinimum) === 0
            : merged.exclusiveMaximum !== undefined &&
              compare(candidate, merged.exclusiveMaximum) === 0)
        )
          q += up ? 1n : -1n;
        q += BigInt(n % 32) * (up ? 1n : -1n);
        return number(String(q * unit) + "e" + z);
      }
      if (t === "string") {
        if (merged.pattern) {
          try {
            const re = new RandExp(new RegExp(merged.pattern, "u"));
            re.max = 128;
            let st = n + seed;
            re.randInt = (a, b) => {
              st = (Math.imul(st, 1664525) + 1013904223) >>> 0;
              return a + (st % (b - a + 1));
            };
            return re.gen();
          } catch {}
        }
        return "a".repeat(
          Math.min(4096, Math.max(count(merged.minLength, 4096), n % 2)),
        );
      }
      if (t === "array") {
        const length = Math.max(
            count(merged.minItems, 32),
            merged.prefixItems?.length ?? 0,
            merged.contains ? Math.max(1, count(merged.minContains, 32)) : 0,
          ),
          out = [];
        if (length > 32) return undefined;
        for (let i = 0; i < length; i++) {
          const item = merged.prefixItems?.[i] ?? merged.items ?? true,
            v = make(item, n + i, depth + 1, next);
          if (v === undefined) return undefined;
          out.push(v);
        }
        if (merged.contains)
          for (
            let i = 0;
            i < Math.min(length, Math.max(1, count(merged.minContains, 32)));
            i++
          ) {
            const v = make(merged.contains, n + i, depth + 1, next);
            if (v !== undefined) out[i] = v;
          }
        return out;
      }
      if (t === "object") {
        const out = {},
          keys = new Set([
            ...merged.required,
            ...Object.keys(merged.properties).filter((_k, i) => n % 2 || i < 4),
          ]);
        for (const k of keys) {
          const p = merged.properties[k] ?? merged.additionalProperties ?? true,
            v = make(p, n + keys.size, depth + 1, next);
          if (v !== undefined) setOwn(out, k, v);
        }
        for (const [k, required] of Object.entries(
          merged.dependentRequired ?? {},
        ))
          if (own(out, k))
            for (const name of required)
              if (!own(out, name)) {
                const v = make(
                  merged.properties[name] ??
                    merged.additionalProperties ??
                    true,
                  n,
                  depth + 1,
                  next,
                );
                if (v !== undefined) setOwn(out, name, v);
              }
        for (
          let i = Object.keys(out).length;
          i < count(merged.minProperties, 32);
          i++
        ) {
          const pattern = Object.keys(merged.patternProperties ?? {})[0];
          let key = "generated" + i;
          if (pattern) {
            try {
              const re = new RandExp(new RegExp(pattern, "u"));
              re.max = 64;
              let state = (seed + n * 257 + i) >>> 0;
              re.randInt = (a, b) => {
                state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
                return a + (state % (b - a + 1));
              };
              key = re.gen();
            } catch {}
          }
          if (own(out, key)) key += i;
          const v = make(
            merged.patternProperties?.[pattern] ??
              merged.additionalProperties ??
              true,
            n + i,
            depth + 1,
            next,
          );
          if (v === undefined) return undefined;
          setOwn(out, key, v);
        }
        return out;
      }
    };
    for (let n = 0; n < 32; n++) {
      const v = make(g.schema, n);
      if (v !== undefined && validate(s, v)) return v;
    }
    for (const v of [null, {}, [], "", 0, 1, false, true, "sample"])
      if (validate(s, v)) return v;
    throw new Error("STANDARD_GENERATION_UNSAT_OR_BUDGET");
  };
  return {
    validate,
    sample,
    shape,
    options,
    graph,
    rootName,
    compile: validator,
  };
}

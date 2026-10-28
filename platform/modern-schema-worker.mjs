import { parentPort } from "node:worker_threads";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parseExact, numeric, compare, setOwn } from "./standard-value.mjs";
function safeProjection(value, depth = 0) {
  if (depth > 64) throw new Error("MODERN_SCHEMA_DEPTH");
  if (numeric(value)) {
    const n = Number(String(value));
    if (!Number.isFinite(n) || compare(value, n) !== 0)
      throw new Error("MODERN_SCHEMA_EXACT_NUMBER_UNSUPPORTED");
    return n;
  }
  if (!value || typeof value !== "object") return value;
  const out = Array.isArray(value) ? [] : {};
  for (const [k, v] of Object.entries(value))
    setOwn(out, k, safeProjection(v, depth + 1));
  return out;
}
parentPort.once("message", ({ schema, data, documents, assertFormats }) => {
  try {
    const ajv = new Ajv2020({
      strict: true,
      strictTypes: false,
      strictTuples: false,
      strictRequired: false,
      validateFormats: assertFormats,
      allErrors: false,
      logger: false,
      ownProperties: true,
    });
    addFormats(ajv);
    // 2020-12 annotations are not 3.0 request-direction prohibitions.
    for (const name of ["xml", "externalDocs", "discriminator", "example"])
      ajv.addKeyword({ keyword: name, valid: true });
    if (
      !documents ||
      Array.isArray(documents) ||
      typeof documents !== "object" ||
      Object.keys(documents).length > 16
    )
      throw new Error("MODERN_SCHEMA_REFERENCES");
    for (const [uri, source] of Object.entries(documents)) {
      const url = new URL(uri);
      if (url.hash || typeof source !== "string")
        throw new Error("MODERN_SCHEMA_REFERENCES");
      ajv.addSchema(safeProjection(parseExact(source)), uri);
    }
    const compile = ajv.compile(safeProjection(parseExact(schema))),
      valid = compile(safeProjection(parseExact(data)));
    parentPort.postMessage({
      valid,
      validator: "ajv-2020-12",
      experimental: true,
      format_policy: assertFormats ? "assertion" : "annotation",
      errors: valid ? [] : compile.errors.map((e) => e.keyword).slice(0, 16),
      openapi_execution_supported: false,
      full_modern_openapi_support: false,
    });
  } catch (e) {
    parentPort.postMessage({
      error: /^MODERN_SCHEMA_[A-Z_]+$/.test(e.message)
        ? e.message
        : "MODERN_SCHEMA_INVALID_OR_UNGRANTED",
    });
  }
});

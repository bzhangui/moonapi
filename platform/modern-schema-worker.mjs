import { parentPort } from "node:worker_threads";
import { parseExact } from "./standard-value.mjs";
import { compileExactModern } from "./modern-exact.mjs";
parentPort.once("message", ({ schema, data, documents, assertFormats }) => {
  try {
    if (
      !documents ||
      Array.isArray(documents) ||
      typeof documents !== "object" ||
      Object.keys(documents).length > 16
    )
      throw new Error("MODERN_SCHEMA_REFERENCES");
    const parsed = Object.fromEntries(
      Object.entries(documents).map(([uri, source]) => {
        if (typeof source !== "string")
          throw new Error("MODERN_SCHEMA_REFERENCES");
        return [uri, parseExact(source)];
      }),
    );
    const validate = compileExactModern(parseExact(schema), parsed, {
      assertFormats,
    });
    parentPort.postMessage({
      ...validate(parseExact(data)),
      validator: "moonapi-exact-evaluator-with-ajv-schema-metadata",
      experimental: true,
      format_policy: assertFormats ? "assertion" : "annotation",
      numeric_policy: "original_decimal_lexemes",
      openapi_execution_supported: false,
      full_modern_openapi_support: false,
    });
  } catch (e) {
    parentPort.postMessage({
      error: /^STANDARD_NUMBER/.test(e.message)
        ? "MODERN_SCHEMA_NUMBER_BUDGET"
        : /^MODERN_SCHEMA_[A-Z_]+$/.test(e.message)
          ? e.message
          : "MODERN_SCHEMA_INVALID_OR_UNGRANTED",
    });
  }
});

// Invoke the public worker API from the relocated bundle, not repository imports.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
const root = path.resolve(process.argv[2]);
const { probeModernSchema } = await import(
  pathToFileURL(path.join(root, "platform/modern-schema.mjs")).href
);
const r = await probeModernSchema(
  '{"contains":{"const":9223372036854775807},"unevaluatedItems":false}',
  "[9223372036854775807]",
);
assert.equal(r.valid, true);
assert.equal(r.openapi_execution_supported, false);
assert.equal(
  (
    await probeModernSchema(
      '{"contains":{"type":"string"},"unevaluatedItems":false}',
      '["ok",1]',
    )
  ).valid,
  false,
);
console.log(
  JSON.stringify({
    relocated_modern_probe: true,
    full_modern_openapi_execution: false,
  }),
);

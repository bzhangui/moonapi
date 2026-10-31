import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { ProjectInspector } from "../platform/inspection-cache.mjs";
const n =
  process.argv.length === 2
    ? 200
    : process.argv.length === 4 && process.argv[2] === "--operations"
      ? Number(process.argv[3])
      : NaN;
if (!Number.isInteger(n) || n < 1 || n > 256)
  throw new Error("SCALE_OPERATIONS_1_TO_256");
const source = JSON.stringify({
  openapi: "3.2.1",
  info: { title: "Controlled scale fixture", version: "1" },
  paths: Object.fromEntries(
    Array.from({ length: n }, (_, i) => [
      "/items" + i,
      {
        get: {
          operationId: "read_" + i,
          parameters: [
            {
              in: "query",
              name: "n",
              required: true,
              schema: { type: "integer", minimum: 1, maximum: 10 },
            },
          ],
          responses: {
            200: {
              description: "ok",
              content: { "application/json": { schema: { type: "integer" } } },
            },
          },
        },
      },
    ]),
  ),
});
const c = new ProjectInspector({ maxBytes: 8388608 });
const start = performance.now();
const first = await c.inspect(source, { limit: 256 });
const firstMs = performance.now() - start;
const next = performance.now(),
  second = await c.inspect(source, { limit: 256 });
const cachedMs = performance.now() - next;
assert.equal(second.metadata_cache_hit, true);
assert.equal(first.blockers.length, 0);
assert.equal(
  first.onboarding.coverage.filter((p) => p.generated > 0).length,
  n,
);
assert.equal(
  first.onboarding.coverage.every((p) => !p.execution_observed),
  true,
);
assert.ok(process.memoryUsage().rss < 1073741824);
console.log(
  JSON.stringify({
    passed: true,
    operations: n,
    document_bytes: Buffer.byteLength(source),
    uncached_ms: Math.round(firstMs),
    metadata_cached_ms: Math.round(cachedMs),
    rss_bytes: process.memoryUsage().rss,
    cache: c.stats,
    http_sent: 0,
    production_capacity_certification: false,
  }),
);
c.clear();

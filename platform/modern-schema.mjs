// Isolated 2020-12 schema probe. This is deliberately NOT a modern OpenAPI
// execution engine, and never downgrades a 3.1/3.2 document to 3.0.
import { Worker } from "node:worker_threads";
export async function probeModernSchema(
  schema,
  data,
  { documents = {}, assertFormats = false, timeout = 2000 } = {},
) {
  if (
    typeof schema !== "string" ||
    typeof data !== "string" ||
    typeof assertFormats !== "boolean" ||
    !Number.isInteger(timeout) ||
    timeout < 100 ||
    timeout > 30000 ||
    Buffer.byteLength(JSON.stringify({ schema, data, documents })) > 1048576
  )
    throw new Error("MODERN_SCHEMA_BUDGET");
  const worker = new Worker(
    new URL("./modern-schema-worker.mjs", import.meta.url),
    {
      execArgv: [],
      resourceLimits: {
        maxOldGenerationSizeMb: 128,
        maxYoungGenerationSizeMb: 16,
        stackSizeMb: 4,
      },
    },
  );
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("MODERN_SCHEMA_CPU_BUDGET")),
        timeout,
      );
      worker.once("message", (r) => {
        clearTimeout(timer);
        r.error ? reject(new Error(r.error)) : resolve(r);
      });
      worker.once("error", () => {
        clearTimeout(timer);
        reject(new Error("MODERN_SCHEMA_WORKER"));
      });
      worker.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("MODERN_SCHEMA_WORKER_EXIT"));
      });
      worker.postMessage({ schema, data, documents, assertFormats });
    });
  } finally {
    await worker.terminate();
  }
}

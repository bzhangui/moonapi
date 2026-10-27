import { Worker } from "node:worker_threads";
export async function inspectDialect(
  source,
  { documents = {}, timeout = 10000 } = {},
) {
  if (
    !Number.isInteger(timeout) ||
    timeout < 100 ||
    timeout > 30000 ||
    typeof source !== "string" ||
    Buffer.byteLength(JSON.stringify({ source, documents })) > 5000000
  )
    throw new Error("DIALECT_BUDGET");
  const worker = new Worker(new URL("./dialect-worker.mjs", import.meta.url), {
    execArgv: [],
    resourceLimits: {
      maxOldGenerationSizeMb: 128,
      maxYoungGenerationSizeMb: 16,
      stackSizeMb: 4,
    },
  });
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("DIALECT_CPU_BUDGET")),
        timeout,
      );
      worker.once("message", (m) => {
        clearTimeout(timer);
        if (m.error) reject(new Error(m.error));
        else resolve(m);
      });
      worker.once("error", () => {
        clearTimeout(timer);
        reject(new Error("DIALECT_WORKER"));
      });
      worker.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("DIALECT_WORKER_EXIT"));
      });
      worker.postMessage({ source, documents });
    });
  } finally {
    await worker.terminate();
  }
}

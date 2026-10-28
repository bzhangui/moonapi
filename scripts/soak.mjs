// Explicit bounded local endurance tier. This does NOT simulate production
// duration, external users, network partitions or multi-host clock behaviour.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { runProject } from "../platform/project-config.mjs";
import {
  workflowFixture,
  workflowSource,
} from "../examples/workflow-fixture.mjs";
const args = process.argv.slice(2),
  rounds =
    args.length === 0
      ? 3
      : args.length === 2 && args[0] === "--rounds"
        ? Number(args[1])
        : NaN;
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 1000)
  throw new Error("SOAK_ROUNDS_1_TO_1000");
const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "moonapi-bounded-soak-"),
  ),
  start = performance.now(),
  f = await workflowFixture();
let maxHeap = 0,
  maxRSS = 0,
  ledgerBytes = 0;
try {
  for (let i = 0; i < rounds; i++) {
    const report = await runProject(
      {
        mode: "owned",
        source: workflowSource(),
        base: f.base,
        resource: {
          create: "create",
          read: "read",
          update: "update",
          remove: "delete",
        },
      },
      { allowWrite: true, allowCleanup: true, journalDirectory: directory },
    );
    if (
      !report.passed ||
      !report.cleanup_verified ||
      report.execution.unknown_writes ||
      f.remaining !== 0
    )
      throw new Error("SOAK_LIFECYCLE");
    globalThis.gc?.();
    const memory = process.memoryUsage();
    maxHeap = Math.max(maxHeap, memory.heapUsed);
    maxRSS = Math.max(maxRSS, memory.rss);
    // Per-round receipts are bounded; do not silently discard recovery data
    // in a real run. Here ALL rows are synthetic and checked before removal.
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name),
        stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8388608)
        throw new Error("SOAK_LEDGER");
      ledgerBytes += stat.size;
      fs.unlinkSync(file);
    }
    if (memory.heapUsed > 268435456 || memory.rss > 1073741824)
      throw new Error("SOAK_MEMORY_BUDGET");
  }
  console.log(
    JSON.stringify({
      passed: true,
      rounds,
      elapsed_ms: Math.round(performance.now() - start),
      max_heap_bytes: maxHeap,
      max_rss_bytes: maxRSS,
      synthetic_ledger_bytes: ledgerBytes,
      production_soak: false,
      real_user_validation: false,
      evidence_scope:
        "single-process local lifecycle and bounded memory/receipt checks",
    }),
  );
} finally {
  await f.close();
  fs.rmSync(directory, { recursive: true });
}

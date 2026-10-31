import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { privateDirectory, atomicPrivate } from "./private-store.mjs";
// No argv, stdout, stderr, environment, cwd, stack or process payload is stored.
export function processFailureReceipt(
  result,
  { tool = "other", elapsedMs = 0 } = {},
) {
  if (!result || (result.status === 0 && !result.error && !result.signal))
    throw new Error("PROCESS_RECEIPT_NOT_FAILURE");
  return {
    format: 1,
    tool: ["node", "moon"].includes(tool) ? tool : "other",
    status: Number.isInteger(result.status) ? result.status : null,
    status_hex: Number.isInteger(result.status)
      ? "0x" + (result.status >>> 0).toString(16).padStart(8, "0")
      : null,
    signal: ["SIGTERM", "SIGKILL", "SIGABRT", "SIGSEGV", "SIGINT"].includes(
      result.signal,
    )
      ? result.signal
      : null,
    spawn_failed: !!result.error,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    elapsed_ms: Number.isFinite(elapsedMs)
      ? Math.max(0, Math.min(86400000, Math.round(elapsedMs)))
      : 0,
    contents_redacted: true,
    root_cause_known: false,
    automatic_retry: false,
  };
}
export function saveProcessFailure(result, directory, options) {
  const receipt = processFailureReceipt(result, options);
  const parent = privateDirectory(directory, { create: true });
  let bytes = 0,
    count = 0;
  for (const name of fs.readdirSync(parent)) {
    const stat = fs.lstatSync(path.join(parent, name));
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error("PROCESS_RECEIPT_DIRECTORY");
    bytes += stat.size;
    count++;
  }
  if (count >= 32 || bytes + 4096 > 262144)
    throw new Error("PROCESS_RECEIPT_BUDGET");
  atomicPrivate(path.join(parent, randomUUID() + ".json"), receipt, {
    maxBytes: 4096,
  });
  return receipt;
}

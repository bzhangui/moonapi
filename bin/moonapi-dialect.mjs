#!/usr/bin/env node
import { readTextInput } from "../platform/input.mjs";
import { inspectDialect } from "../platform/dialects.mjs";
try {
  if (process.argv.length !== 3) throw new Error();
  const r = await inspectDialect(readTextInput(process.argv[2], 1048576));
  console.log(JSON.stringify(r, null, 2));
  if (!r.structurally_valid) process.exitCode = 1;
} catch {
  console.error("DIALECT_INSPECTION_FAILED_CONTENTS_HIDDEN");
  process.exitCode = 2;
}

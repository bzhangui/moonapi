import fs from "node:fs";

// Bound actual bytes read, not only the earlier stat, and never echo input or paths.
export function readTextInput(file, limit) {
  if (
    typeof file !== "string" ||
    !file ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 1048576
  )
    throw new Error("Invalid input file or byte budget");
  let descriptor;
  try {
    descriptor = fs.openSync(file, "r");
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > limit) throw new Error();
    const bytes = Buffer.alloc(limit + 1);
    let used = 0;
    while (used < bytes.length) {
      const count = fs.readSync(
        descriptor,
        bytes,
        used,
        bytes.length - used,
        null,
      );
      if (count === 0) break;
      used += count;
    }
    if (used > limit) throw new Error();
    return new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(0, used),
    );
  } catch {
    throw new Error("Missing, oversized or invalid UTF-8 input file");
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {}
    }
  }
}

export function readJsonInput(file, limit) {
  const text = readTextInput(file, limit);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON input (contents hidden)");
  }
}

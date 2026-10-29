// Method names are case-sensitive HTTP tokens. Lower-case additionalOperations
// are not silently upgraded to safe registered upper-case methods.
export function isReadOnlyMethod(method) {
  if (typeof method !== "string") return false;
  if (typeof globalThis.__moonapi_core === "function") {
    const result = JSON.parse(
      globalThis.__moonapi_core(
        JSON.stringify({ action: "standard-read-only", method }),
      ),
    );
    return result.ok === true && result.value === true;
  }
  return ["GET", "HEAD", "OPTIONS", "QUERY"].includes(method);
}

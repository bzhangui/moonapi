// Public diagnostics are a fixed taxonomy, never an echo of untrusted input.
export function failureCategory(
  code,
  { unknownWrite = false, cleanupFailed = false } = {},
) {
  if (unknownWrite) return "unknown_write";
  if (cleanupFailed) return "cleanup";
  if (typeof code !== "string" || code.length > 128) return "internal";
  if (/GENERATION|no_generated_case|generation_/.test(code))
    return "generation";
  if (/BUDGET|DEADLINE|TIMEOUT|total_deadline|^budget$/.test(code))
    return "budget";
  if (/PERMISSION|DENIED|SELECTION|AUTHORIZ|^permission$/.test(code))
    return "permission";
  if (/CREDENTIAL|AUTHENTICATION|^authentication$/.test(code))
    return "authentication";
  if (/TRANSPORT|NETWORK|WORKER_EXIT|WORKER_ERROR|^transport$/.test(code))
    return "transport";
  if (
    /CONTRACT|response_schema|undeclared_status|server_error|^defect$/.test(
      code,
    )
  )
    return "contract";
  if (/DOCUMENT|ENCODING|SCHEMA|INPUT|OPTIONS/.test(code)) return "input";
  return "internal";
}
export function explainBlockers(blockers = []) {
  if (!Array.isArray(blockers) || blockers.length > 4096)
    throw new Error("DIAGNOSTIC_BUDGET");
  const counts = {};
  for (const b of blockers) {
    const category = failureCategory(b?.reason ?? b?.code);
    counts[category] = (counts[category] ?? 0) + 1;
  }
  return { counts, contents_redacted: true, blocked_is_passed: false };
}

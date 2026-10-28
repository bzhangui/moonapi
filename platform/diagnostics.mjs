// Fixed, redacted actions. Never reflect untrusted codes, payloads, URLs or
// messages into a public report, and never grant permissions or replay writes.
export function diagnoseReport(report) {
  if (!report || typeof report !== "object" || Array.isArray(report))
    throw new Error("DIAGNOSTIC_REPORT");
  const actions = [];
  if (report.execution?.unknown_writes > 0)
    actions.push({
      code: "unknown_write",
      action:
        "Stop writes and resets. Inspect encrypted intents and authoritative read-only receipts; hand unresolved resources to the operator.",
    });
  if (report.cleanup_verified === false)
    actions.push({
      code: "cleanup_unconfirmed",
      action:
        "Keep the disposable namespace isolated. Recheck ownership before any manual cleanup; never broaden DELETE scope.",
    });
  if (
    report.category === "budget" ||
    report.blockers?.some?.((b) => b?.code === "total_deadline")
  )
    actions.push({
      code: "budget",
      action:
        "Review private elapsed time and byte/item limits. Reduce case count first; do not retry unknown writes.",
    });
  if (report.category === "transport")
    actions.push({
      code: "transport",
      action:
        "Check the authorized endpoint, certificate and local service. Missing response is not evidence of non-commit.",
    });
  if (report.category === "defect")
    actions.push({
      code: "defect",
      action:
        "Review the private fingerprint and independently confirmed witness in a disposable environment. A local witness is not a real-user report.",
    });
  if (!actions.length && report.passed !== true)
    actions.push({
      code: "blocked_or_incomplete",
      action:
        "Inspect the private blockers, schema/dialect, role configuration and explicit permissions. Do not treat blocked or incomplete runs as passed.",
    });
  return {
    format: 1,
    contents_redacted: true,
    automatic_replay_permitted: false,
    actions,
  };
}

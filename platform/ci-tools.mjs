import fs from "node:fs";
import { createHash } from "node:crypto";
import { parseExact, stringifyExact } from "./standard-value.mjs";
const digest = (text) => createHash("sha256").update(text).digest("hex");
const methods = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
];
const operations = (d) =>
  Object.entries(d.paths || {}).flatMap(([route, item]) =>
    methods
      .filter((m) => item[m])
      .map((m) => ({
        id: item[m].operationId || m.toUpperCase() + " " + route,
        route,
        method: m,
        operation: item[m],
        item,
      })),
  );
export function contractDiff(
  before,
  after,
  { beforeDocuments = {}, afterDocuments = {} } = {},
) {
  // Accept exact parsed JSON objects. For YAML, callers must use a lossless
  // normalizer; the CLI conservatively selects the full suite instead.
  const a = operations(before),
    b = operations(after),
    strip = (d) =>
      Object.fromEntries(Object.entries(d).filter(([k]) => k !== "paths"));
  const global =
    stringifyExact(strip(before)) !== stringifyExact(strip(after)) ||
    documentDigest("", beforeDocuments) !== documentDigest("", afterDocuments);
  const affected = b
    .filter(
      (op) =>
        global ||
        !a.some(
          (old) =>
            old.id === op.id &&
            old.route === op.route &&
            old.method === op.method &&
            stringifyExact(old.item) === stringifyExact(op.item),
        ),
    )
    .map((o) => o.id);
  return {
    format: 1,
    affected,
    removed: a.filter((x) => !b.some((y) => x.id === y.id)).map((x) => x.id),
    full_suite_required: global,
    policy:
      "Conservative path-item diff; any component, security, server, or external-reference change selects all current operations.",
  };
}
export function documentDigest(source, documents = {}) {
  return digest(
    stringifyExact({
      source,
      documents: Object.fromEntries(
        Object.entries(documents).sort(([a], [b]) => a.localeCompare(b)),
      ),
    }),
  );
}
export function historyFor(report, documentHash) {
  return {
    format: 1,
    document_hash: documentHash,
    failed_operations: [
      ...new Set(
        (report.records || [])
          .filter((r) => !r.passed)
          .map((r) => r.operation_id)
          .filter((x) => typeof x === "string"),
      ),
    ],
  };
}
export function historyPriority(history, documentHash, known) {
  if (
    history?.format !== 1 ||
    history.document_hash !== documentHash ||
    !Array.isArray(history.failed_operations) ||
    history.failed_operations.length > 256
  )
    return [];
  return history.failed_operations.filter((id) => known.includes(id));
}
export function writePrivate(file, value) {
  fs.writeFileSync(file, stringifyExact(value), { flag: "wx", mode: 0o600 });
}
export function saveReplay(
  file,
  { source, documents = {}, model, credentialEnvironment },
  authorized = false,
) {
  if (authorized !== true)
    throw new Error("REPLAY_PRIVATE_EXPORT_NOT_AUTHORIZED");
  if (
    credentialEnvironment !== undefined &&
    !/^[A-Z_][A-Z0-9_]{0,127}$/.test(credentialEnvironment)
  )
    throw new Error("REPLAY_ENVIRONMENT_REFERENCE");
  writePrivate(file, {
    format: 1,
    private: true,
    document_hash: documentDigest(source, documents),
    model,
    credential_environment: credentialEnvironment,
  });
}
export function loadReplay(file, { source, documents = {} }) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 524288)
    throw new Error("REPLAY_FILE");
  const data = parseExact(fs.readFileSync(file, "utf8"));
  if (
    data.format !== 1 ||
    data.private !== true ||
    data.document_hash !== documentDigest(source, documents)
  )
    throw new Error("REPLAY_DOCUMENT_MISMATCH");
  if (
    data.credential_environment !== undefined &&
    !/^[A-Z_][A-Z0-9_]{0,127}$/.test(data.credential_environment)
  )
    throw new Error("REPLAY_ENVIRONMENT_REFERENCE");
  return data;
}
const categories = new Set([
  "passed",
  "defect",
  "transport",
  "inconclusive",
  "blocked",
  "budget",
  "unsupported",
]);
const codes = new Set([
  "",
  "transport",
  "server_error",
  "response_contract",
  "negative_accepted",
  "positive_rejected",
  "access_or_rate_limit",
  "redirect_not_followed",
  "callback_contract_or_timeout",
  "total_deadline",
  "business_equal",
  "business_not_equal",
  "business_exists",
  "business_absent",
  "business_status",
  "business_count",
  "reset_failed",
  "reset_unconfirmed",
  "binding_missing",
  "request_contract_or_policy",
]);
export function publicReport(report) {
  const records = (report.records || []).map((r, i) => ({
    case: i + 1,
    status:
      Number.isInteger(r.status) && r.status >= 0 && r.status <= 599
        ? r.status
        : 0,
    passed: r.passed === true,
    category: categories.has(r.category)
      ? r.category
      : r.passed
        ? "passed"
        : "blocked",
    code: codes.has(r.code) ? r.code : "execution_blocked",
  }));
  const blockers = (report.blockers || []).length;
  return {
    format: 1,
    passed: report.passed === true,
    complete: report.complete === true,
    executed: records.length,
    blockers,
    truncated: report.truncated === true,
    category: categories.has(report.category) ? report.category : undefined,
    real_user_validation: false,
    records,
  };
}
const escape = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function renderReports(report) {
  const data = publicReport(report),
    records = data.records;
  let failures = 0,
    errors = 0,
    skipped = 0;
  const cases = records.map((r) => {
    const message = escape(r.code || r.category);
    let outcome = "";
    if (!r.passed) {
      if (r.category === "defect") {
        failures++;
        outcome = `<failure message="${message}"/>`;
      } else if (
        ["inconclusive", "blocked", "unsupported"].includes(r.category)
      ) {
        skipped++;
        outcome = `<skipped message="${message}"/>`;
      } else {
        errors++;
        outcome = `<error message="${message}"/>`;
      }
    }
    return `<testcase name="case-${r.case}" classname="MoonAPI">${outcome}</testcase>`;
  });
  // An empty/partially blocked run must not become an empty-green JUnit suite.
  if (
    !data.passed &&
    (data.blockers ||
      data.truncated ||
      !records.length ||
      records.every((r) => r.passed))
  ) {
    errors++;
    cases.push(
      '<testcase name="execution-completeness"><error message="incomplete_or_blocked"/></testcase>',
    );
  }
  const junit = `<?xml version="1.0" encoding="UTF-8"?><testsuite name="MoonAPI" tests="${cases.length}" failures="${failures}" errors="${errors}" skipped="${skipped}">${cases.join("")}</testsuite>`;
  const html = `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>MoonAPI 回归摘要</title><style>body{font:16px system-ui;max-width:900px;margin:3rem auto;padding:1rem;color:#182b40}table{border-collapse:collapse;width:100%}td,th{padding:.7rem;border-bottom:1px solid #ccc;text-align:left}h1{font-size:2rem}</style><h1>MoonAPI 回归摘要</h1><p>${data.passed ? "通过" : "未通过 / 不完整"} · 执行 ${records.length} · 阻塞 ${data.blockers}</p><p>不含 URL、操作名、凭据和请求/响应体。受控测试不等于真实用户验证。</p><table><thead><tr><th>用例</th><th>HTTP</th><th>分类</th><th>结果</th></tr></thead><tbody>${records.map((r) => `<tr><td>${r.case}</td><td>${r.status}</td><td>${escape(r.category)}</td><td>${escape(r.code || "passed")}</td></tr>`).join("")}</tbody></table></html>`;
  return { json: JSON.stringify(data, null, 2), junit, html };
}

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
const root = fileURLToPath(new URL("../", import.meta.url));
export const VERSION = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
).version;
const artifact = path.join(
  root,
  "_build/js/release/build/cmd/bridge/bridge.js",
);
function checkedOptions(value, allowed, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error(label + " must be an options object");
  for (const key of Reflect.ownKeys(value))
    if (!allowed.includes(key))
      throw new Error("Unsupported " + label + " option");
  return value;
}
function deadlineError() {
  return Object.assign(new Error("Total execution deadline reached"), {
    code: "MOONAPI_TOTAL_DEADLINE",
  });
}
export async function loadCore() {
  if (!fs.existsSync(artifact)) throw new Error("Build first: npm run build");
  await import(pathToFileURL(artifact));
  return globalThis.__moonapi_core;
}
export class Engine {
  constructor(source, options = {}) {
    checkedOptions(
      options,
      [
        "timeout",
        "totalTimeout",
        "limit",
        "seed",
        "allowWrite",
        "allowRemote",
        "shrinkWrite",
        "shrinkBudget",
        "bearerToken",
      ],
      "engine",
    );
    if (typeof source !== "string" || Buffer.byteLength(source) > 524288)
      throw new Error("OpenAPI file exceeds 512 KiB");
    this.source = source;
    this.options = {
      timeout: 1500,
      totalTimeout: 60000,
      limit: 64,
      seed: 42,
      allowWrite: false,
      allowRemote: false,
      shrinkWrite: false,
      shrinkBudget: 32,
      ...options,
    };
    for (const key of ["allowWrite", "allowRemote", "shrinkWrite"])
      if (typeof this.options[key] !== "boolean")
        throw new Error(key + " must be boolean");
    if (
      this.options.bearerToken !== undefined &&
      (typeof this.options.bearerToken !== "string" ||
        Buffer.byteLength(this.options.bearerToken) > 4096 ||
        /[\x00-\x1f\x7f]/.test(this.options.bearerToken))
    )
      throw new Error("Invalid bearer token encoding");
    for (const [key, min, max] of [
      ["timeout", 10, 30000],
      ["totalTimeout", 100, 600000],
      ["limit", 1, 256],
      ["seed", 0, 1000000],
      ["shrinkBudget", 0, 128],
    ])
      if (
        !Number.isInteger(this.options[key]) ||
        this.options[key] < min ||
        this.options[key] > max
      )
        throw new Error("Invalid " + key + " budget");
  }
  command(action, args = {}) {
    const response = JSON.parse(
      globalThis.__moonapi_core(
        JSON.stringify({
          action,
          source: this.source,
          seed: this.options.seed,
          ...args,
        }),
      ),
    );
    if (!response.ok) throw new Error(response.error);
    return response.value;
  }
  plan() {
    return this.command("plan", {
      seed: this.options.seed,
      limit: this.options.limit,
    }).cases;
  }
  base(base) {
    const u = new URL(base);
    if (
      !["http:", "https:"].includes(u.protocol) ||
      u.username ||
      u.password ||
      u.hash ||
      u.search
    )
      throw new Error("Invalid base URL");
    const local = ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
    if (!this.options.allowRemote && !local)
      throw new Error(
        "Remote targets require --allow-remote and authorization",
      );
    if (this.options.bearerToken && !local && u.protocol !== "https:")
      throw new Error("Remote bearer authentication requires HTTPS");
    if (
      u.protocol === "https:" &&
      process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0"
    )
      throw new Error("TLS certificate verification must not be disabled");
    return u;
  }
  permitted(test) {
    return (
      ["GET", "HEAD", "OPTIONS"].includes(test.verb) || this.options.allowWrite
    );
  }
  async observe(base, test, deadline) {
    if (!this.permitted(test))
      throw new Error("Write methods require --allow-write");
    let route = test.path;
    const u = this.base(base);
    const query = [];
    for (const p of test.parameters) {
      if (p.in === "path") {
        if ([".", ".."].includes(String(p.value)))
          throw new Error("Dot-segment path value rejected");
        route = route.replaceAll(
          "{" + p.name + "}",
          encodeURIComponent(String(p.value)),
        );
      } else query.push(p);
    }
    if (
      route.includes("{") ||
      route.includes("}") ||
      route.includes("\\") ||
      route.startsWith("//") ||
      decodeURIComponent(route)
        .split("/")
        .some((p) => p === "." || p === "..")
    )
      throw new Error("Unbound or unsafe path template");
    const target = new URL(u.href.replace(/\/$/, "") + route);
    if (target.origin !== u.origin) throw new Error("Target origin changed");
    for (const p of query) target.searchParams.append(p.name, String(p.value));
    if (target.href.length > 8192) throw new Error("URL byte budget exceeded");
    const payload = test.has_body ? JSON.stringify(test.body) : undefined;
    if (payload && Buffer.byteLength(payload) > 262144)
      throw new Error("Request payload exceeds 256 KiB");
    const headers = {
      accept: "application/json",
      ...(payload ? { "content-type": "application/json" } : {}),
    };
    if (this.options.bearerToken)
      headers.authorization = "Bearer " + this.options.bearerToken;
    const remaining = Math.min(this.options.timeout, deadline - Date.now());
    if (remaining <= 0) throw deadlineError();
    let observation;
    try {
      const response = await fetch(target, {
        method: test.verb,
        headers,
        body: payload,
        redirect: "error",
        signal: AbortSignal.timeout(remaining),
      });
      let size = 0;
      const chunks = [];
      for await (const chunk of response.body || []) {
        size += chunk.length;
        if (size > 262144) throw new Error("Response budget");
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks),
        raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      let body = null,
        jsonValid = false;
      if (raw) {
        try {
          body = JSON.parse(raw);
          jsonValid = true;
        } catch {}
      }
      observation = {
        status: response.status,
        body,
        raw,
        json_valid: jsonValid,
        response_bytes: size,
      };
    } catch {
      observation = {
        status: 0,
        body: null,
        json_valid: false,
        response_bytes: 0,
      };
    }
    const finding = this.command("validate", {
      case: test,
      ...observation,
    }).finding;
    return { ...observation, finding };
  }
  async shrink(base, test, initial, deadline) {
    let best = test,
      observation = initial,
      attempts = 0;
    if (
      !["GET", "HEAD", "OPTIONS"].includes(test.verb) &&
      !this.options.shrinkWrite
    )
      return {
        case: best,
        observation,
        attempts,
        reason: "write_shrinking_not_authorized",
      };
    if (
      initial.status === 0 ||
      ["access_or_rate_limit"].some((code) =>
        initial.finding.issues.some((i) => i.code === code),
      )
    )
      return {
        case: best,
        observation,
        attempts,
        reason: "transport_or_access_failure",
      };
    let improved = true;
    while (
      improved &&
      attempts < this.options.shrinkBudget &&
      Date.now() < deadline
    ) {
      improved = false;
      for (const candidate of this.command("shrink", { case: best })
        .candidates) {
        if (attempts >= this.options.shrinkBudget || Date.now() >= deadline)
          break;
        attempts++;
        let next;
        try {
          next = await this.observe(base, candidate, deadline);
        } catch (error) {
          if (error.code === "MOONAPI_TOTAL_DEADLINE")
            return {
              case: best,
              observation,
              attempts,
              reason: "total_deadline",
            };
          throw error;
        }
        if (
          !next.finding.passed &&
          next.finding.fingerprint === initial.finding.fingerprint
        ) {
          best = candidate;
          observation = next;
          improved = true;
          break;
        }
      }
    }
    return {
      case: best,
      observation,
      attempts,
      reason: "same_fingerprint_and_validity_preserved",
    };
  }
  async run(base, options = {}) {
    checkedOptions(options, ["scenario", "saveRepro"], "run");
    const { scenario = null, saveRepro = false } = options;
    if (typeof saveRepro !== "boolean")
      throw new Error("saveRepro must be boolean");
    this.base(base);
    const deadline = Date.now() + this.options.totalTimeout;
    const results = [],
      repros = [],
      errors = [];
    let skipped = 0,
      bindings = {},
      planned = 0,
      stopReason = "completed";
    const record = async (test, shrinkAllowed = true) => {
      const seen = await this.observe(base, test, deadline);
      const minimum = seen.finding.passed
        ? { case: test, observation: seen, attempts: 0, reason: "passed" }
        : shrinkAllowed
          ? await this.shrink(base, test, seen, deadline)
          : {
              case: test,
              observation: seen,
              attempts: 0,
              reason: "stateful_sequence_requires_reset_mode",
            };
      results.push({
        case_id: test.id,
        operation_id: test.operation_id,
        verb: test.verb,
        negative: test.negative,
        status: seen.status,
        passed: seen.finding.passed,
        issues: seen.finding.issues,
        fingerprint: seen.finding.fingerprint,
        original_body_bytes: Buffer.byteLength(JSON.stringify(test.body)),
        minimized_body_bytes: Buffer.byteLength(
          JSON.stringify(minimum.case.body),
        ),
        shrink_attempts: minimum.attempts,
        shrink_reason: minimum.reason,
      });
      if (saveRepro && !seen.finding.passed)
        repros.push({
          case: minimum.case,
          fingerprint: seen.finding.fingerprint,
        });
      return seen;
    };
    if (scenario !== null) {
      checkedOptions(scenario, ["name", "steps"], "scenario");
      if (
        scenario.name !== undefined &&
        (typeof scenario.name !== "string" ||
          Buffer.byteLength(scenario.name) > 256)
      )
        throw new Error("Invalid scenario name");
      if (Buffer.byteLength(JSON.stringify(scenario)) > 65536)
        throw new Error("Scenario exceeds 64 KiB");
      if (
        !Array.isArray(scenario.steps) ||
        !scenario.steps.length ||
        scenario.steps.length > 64
      )
        throw new Error("Scenario requires 1..64 steps");
      planned = scenario.steps.length;
      // Preflight all operation permissions before the first mutation.
      const verbs = new Map(
        this.command("plan", { limit: 1 }).operations.map((op) => [
          op.id,
          op.verb,
        ]),
      );
      for (const step of scenario.steps) {
        checkedOptions(
          step,
          [
            "operationId",
            "parameters",
            "body",
            "negative",
            "status",
            "capture",
          ],
          "scenario step",
        );
        if (step.parameters !== undefined)
          checkedOptions(
            step.parameters,
            Object.keys(step.parameters || {}),
            "scenario parameters",
          );
        if (step.capture !== undefined) {
          checkedOptions(
            step.capture,
            Object.keys(step.capture || {}),
            "scenario captures",
          );
          if (
            Object.values(step.capture).some(
              (value) => typeof value !== "string",
            )
          )
            throw new Error("Capture pointers must be strings");
        }
        if (step.negative !== undefined && typeof step.negative !== "boolean")
          throw new Error("Scenario negative must be boolean");
        if (
          step.status !== undefined &&
          (!Number.isInteger(step.status) ||
            step.status < 100 ||
            step.status > 599)
        )
          throw new Error("Scenario status must be HTTP status");
        if (!verbs.has(step.operationId))
          throw new Error("Unknown scenario operation");
        if (
          !["GET", "HEAD", "OPTIONS"].includes(verbs.get(step.operationId)) &&
          !this.options.allowWrite
        )
          throw new Error("Scenario requires --allow-write");
      }
      for (const [index, step] of scenario.steps.entries()) {
        if (Date.now() >= deadline) {
          stopReason = "total_deadline";
          break;
        }
        let stage = "binding";
        try {
          const test = this.command("scenario", { step, bindings }).case;
          test.id += "-step-" + (index + 1);
          stage = "execution";
          const seen = await record(test, false);
          if (!seen.finding.passed) {
            stopReason = "scenario_failure";
            break;
          }
          stage = "capture";
          bindings = this.command("capture", {
            step,
            body: seen.body,
            bindings,
          }).bindings;
        } catch (error) {
          if (error.code === "MOONAPI_TOTAL_DEADLINE") {
            stopReason = "total_deadline";
            break;
          }
          if (!results.length) throw error;
          stopReason = "scenario_configuration_error";
          errors.push({ step: index + 1, stage, code: "configuration_error" });
          break;
        }
      }
    } else {
      const cases = this.plan();
      planned = cases.length;
      skipped = cases.filter((test) => !this.permitted(test)).length;
      for (const test of cases) {
        if (!this.permitted(test)) continue;
        if (Date.now() >= deadline) {
          stopReason = "total_deadline";
          break;
        }
        try {
          await record(test);
        } catch (error) {
          if (error.code === "MOONAPI_TOTAL_DEADLINE") {
            stopReason = "total_deadline";
            break;
          }
          throw error;
        }
      }
    }
    const report = {
      format: 1,
      tool: "MoonAPI",
      version: VERSION,
      full_openapi_support: false,
      contract_profile: "moonapi-oas30-json-v1",
      seed: this.options.seed,
      controlled_simulation: false,
      real_user_pilot: false,
      planned,
      executed: results.length,
      skipped,
      not_executed: planned - results.length - skipped,
      stop_reason: stopReason,
      passed: results.filter((r) => r.passed).length,
      failed: results.filter((r) => !r.passed).length,
      complete:
        stopReason === "completed" &&
        skipped === 0 &&
        results.length === planned,
      results,
    };
    if (saveRepro) report.reproductions = repros;
    if (errors.length) report.errors = errors;
    return report;
  }
}
export function saveReport(report, { projectRoot = root } = {}) {
  let dir = fs.realpathSync(projectRoot);
  for (const part of [".local", "reports"]) {
    dir = path.join(dir, part);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { mode: 0o700 });
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("Private report directory must not be a link");
  }
  const file = path.join(dir, "report-" + randomUUID() + ".json");
  fs.writeFileSync(file, JSON.stringify(report, null, 2), {
    flag: "wx",
    mode: 0o600,
  });
  return file;
}

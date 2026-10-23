import { Worker } from "node:worker_threads";
import { Engine, loadCore, VERSION } from "./runner.mjs";
import { encodeRequest, resolveServer } from "./standard-codec.mjs";

function policy(action, args) {
  const result = JSON.parse(
    globalThis.__moonapi_core(JSON.stringify({ action, ...args })),
  );
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
class StandardWorker {
  #worker;
  #pending = new Map();
  #id = 0;
  #closed = false;
  #termination;
  constructor(timeout) {
    this.timeout = timeout;
    this.#worker = new Worker(
      new URL("./standard-worker.mjs", import.meta.url),
      {
        execArgv: [],
        resourceLimits: {
          maxOldGenerationSizeMb: 128,
          maxYoungGenerationSizeMb: 16,
          stackSizeMb: 4,
        },
      },
    );
    this.#worker.on("message", (result) => {
      const pending = this.#pending.get(result.id);
      if (!pending) return;
      this.#pending.delete(result.id);
      clearTimeout(pending.timer);
      if (result.ok) pending.resolve(result.value);
      else pending.reject(new Error(result.code));
    });
    this.#worker.on("error", () => this.close("STANDARD_WORKER_ERROR"));
    this.#worker.on("exit", () => this.close("STANDARD_WORKER_EXIT"));
  }
  call(action, args) {
    if (this.#closed)
      return Promise.reject(new Error("STANDARD_WORKER_CLOSED"));
    try {
      if (Buffer.byteLength(JSON.stringify(args)) > 4194304) throw new Error();
    } catch {
      return Promise.reject(new Error("STANDARD_COMMAND_BUDGET"));
    }
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.close("STANDARD_CPU_BUDGET");
      }, this.timeout);
      this.#pending.set(id, { resolve, reject, timer });
      try {
        this.#worker.postMessage({ id, action, args });
      } catch {
        this.#pending.delete(id);
        clearTimeout(timer);
        reject(new Error("STANDARD_COMMAND_ENCODING"));
      }
    });
  }
  async close(code = "STANDARD_WORKER_CLOSED") {
    if (this.#closed) return this.#termination;
    this.#closed = true;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(code));
    }
    this.#pending.clear();
    this.#termination = this.#worker.terminate();
    await this.#termination;
  }
}
export class StandardEngine {
  #worker;
  #busy = false;
  #plan;
  #credentials;
  #description;
  #closed = false;
  #httpAbort;
  get description() {
    return structuredClone(this.#description);
  }
  static async open(source, options = {}) {
    const allowed = [
      "seed",
      "limit",
      "allowWrite",
      "allowRemote",
      "timeout",
      "totalTimeout",
      "compilerTimeout",
      "documents",
      "credentials",
    ];
    if (
      !options ||
      typeof options !== "object" ||
      Array.isArray(options) ||
      Reflect.ownKeys(options).some((k) => !allowed.includes(k))
    )
      throw new Error("STANDARD_OPTIONS");
    if (typeof source !== "string" || Buffer.byteLength(source) > 1048576)
      throw new Error("STANDARD_DOCUMENT_BUDGET");
    const settings = {
      seed: 42,
      limit: 256,
      allowWrite: false,
      allowRemote: false,
      timeout: 2000,
      totalTimeout: 60000,
      compilerTimeout: 10000,
      ...options,
    };
    for (const [key, min, max] of [
      ["seed", 0, 1000000],
      ["limit", 1, 256],
      ["timeout", 10, 30000],
      ["totalTimeout", 100, 600000],
      ["compilerTimeout", 100, 30000],
    ])
      if (
        !Number.isInteger(settings[key]) ||
        settings[key] < min ||
        settings[key] > max
      )
        throw new Error("STANDARD_OPTIONS");
    for (const key of ["allowWrite", "allowRemote"])
      if (typeof settings[key] !== "boolean")
        throw new Error("STANDARD_OPTIONS");
    await loadCore();
    const engine = new StandardEngine();
    engine.options = Object.freeze({
      seed: settings.seed,
      limit: settings.limit,
      allowWrite: settings.allowWrite,
      allowRemote: settings.allowRemote,
      timeout: settings.timeout,
      totalTimeout: settings.totalTimeout,
    });
    engine.#credentials = structuredClone(settings.credentials ?? {});
    if (
      !engine.#credentials ||
      typeof engine.#credentials !== "object" ||
      Array.isArray(engine.#credentials)
    )
      throw new Error("STANDARD_CREDENTIALS");
    if (Buffer.byteLength(JSON.stringify(engine.#credentials)) > 16384)
      throw new Error("STANDARD_CREDENTIAL_BUDGET");
    engine.#worker = new StandardWorker(settings.compilerTimeout);
    try {
      engine.#description = await engine.#worker.call("compile", {
        source,
        documents: settings.documents,
      });
      return engine;
    } catch (error) {
      await engine.close();
      throw error;
    }
  }
  async close() {
    this.#closed = true;
    this.#httpAbort?.abort();
    await this.#worker?.close();
  }
  async plan() {
    if (this.#closed) throw new Error("STANDARD_ENGINE_CLOSED");
    if (this.#busy) throw new Error("STANDARD_ENGINE_BUSY");
    if (this.#plan) return structuredClone(this.#plan);
    this.#busy = true;
    try {
      const catalog = [],
        variants = new Map(),
        blockers = [];
      for (const op of this.#description.operations) {
        for (const code of op.blockers)
          blockers.push({ operation_id: op.id, code });
        try {
          const values = await this.#worker.call("variants", {
            id: op.id,
            seed: this.options.seed,
          });
          const verified = [];
          for (const value of values) {
            const contract = await this.validateRequest(value);
            if (contract.valid !== !value.negative) {
              blockers.push({
                operation_id: op.id,
                code: "generation_contract_mismatch",
              });
              continue;
            }
            verified.push(value);
          }
          variants.set(op.id, verified);
          catalog.push({ id: op.id, count: verified.length });
          if (!verified.length)
            blockers.push({ operation_id: op.id, code: "no_generated_case" });
        } catch (error) {
          blockers.push({
            operation_id: op.id,
            code: "generation_unsatisfied_or_budget",
            reason: /^STANDARD_[A-Z_]+$/.test(error.message)
              ? error.message
              : "STANDARD_VALIDATION_ERROR",
          });
        }
      }
      const scheduled = policy("standard-schedule", {
        catalog,
        seed: this.options.seed,
        limit: this.options.limit,
      });
      const cases = scheduled.selected.map(
        ({ operation_id, variant }, index) => ({
          ...variants.get(operation_id)[variant],
          id: `standard-${index + 1}`,
        }),
      );
      this.#plan = {
        cases,
        blockers,
        truncated: scheduled.truncated,
        available: scheduled.available,
        full_openapi_support: false,
      };
      return structuredClone(this.#plan);
    } finally {
      this.#busy = false;
    }
  }
  async validateRequest(test) {
    if (this.#closed) throw new Error("STANDARD_ENGINE_CLOSED");
    return this.#worker.call("request", { id: test.operation_id, test });
  }
  async validateResponse(id, status, body, headers, empty = false) {
    if (this.#closed) throw new Error("STANDARD_ENGINE_CLOSED");
    if (
      !Number.isInteger(status) ||
      status < 100 ||
      status > 599 ||
      !headers ||
      typeof headers !== "object"
    )
      throw new Error("STANDARD_RESPONSE_INPUT");
    const normalized = Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]),
    );
    return this.#worker.call("response", {
      id,
      status,
      body,
      headers: normalized,
      empty,
    });
  }
  #auth(operation, target, request) {
    if (
      !operation.security.length ||
      operation.security.some((r) => Object.keys(r).length === 0)
    )
      return;
    const alternative = operation.security.find((requirement) =>
      Object.entries(requirement).every(([name, scopes]) => {
        const credential = this.#credentials[name];
        return (
          credential &&
          scopes.every((scope) => credential.scopes?.includes(scope))
        );
      }),
    );
    if (!alternative) throw new Error("STANDARD_AUTH_NOT_PROVIDED");
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) &&
      target.protocol !== "https:"
    )
      throw new Error("STANDARD_AUTH_REQUIRES_TLS");
    const destinations = new Map();
    const checkDestination = (key, value) => {
      if (destinations.has(key) && destinations.get(key) !== value)
        throw new Error("STANDARD_AUTH_DESTINATION_COLLISION");
      destinations.set(key, value);
    };
    for (const name of Object.keys(alternative)) {
      const scheme = operation.security_schemes[name],
        credential = this.#credentials[name];
      if (
        scheme.type === "http" &&
        scheme.scheme?.toLowerCase() === "basic" &&
        (typeof credential.username !== "string" ||
          typeof credential.password !== "string" ||
          /[:\x00-\x1f\x7f]/.test(credential.username) ||
          /[\x00-\x1f\x7f]/.test(credential.password))
      )
        throw new Error("STANDARD_BASIC_CREDENTIALS");
      const value =
        scheme.type === "http" && scheme.scheme?.toLowerCase() === "basic"
          ? Buffer.from(
              `${credential.username ?? ""}:${credential.password ?? ""}`,
            ).toString("base64")
          : credential.value;
      if (
        typeof value !== "string" ||
        !value ||
        Buffer.byteLength(value) > 4096 ||
        /[\x00-\x1f\x7f]/.test(value)
      )
        throw new Error("STANDARD_CREDENTIAL_ENCODING");
      checkDestination(
        scheme.type === "apiKey"
          ? scheme.in +
              ":" +
              (scheme.in === "header" ? scheme.name.toLowerCase() : scheme.name)
          : "header:authorization",
        scheme.type === "apiKey"
          ? value
          : (scheme.scheme?.toLowerCase() === "basic" ? "Basic " : "Bearer ") +
              value,
      );
      if (scheme.type === "apiKey") {
        if (scheme.in === "query") target.searchParams.set(scheme.name, value);
        else if (scheme.in === "header") {
          if (
            !/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(scheme.name) ||
            [
              "host",
              "content-length",
              "connection",
              "transfer-encoding",
            ].includes(scheme.name.toLowerCase())
          )
            throw new Error("STANDARD_AUTH_HEADER");
          request.headers[scheme.name.toLowerCase()] = value;
        } else
          request.headers.cookie =
            (request.headers.cookie ? request.headers.cookie + "; " : "") +
            encodeURIComponent(scheme.name) +
            "=" +
            encodeURIComponent(value);
      } else if (
        ["oauth2", "openIdConnect"].includes(scheme.type) ||
        (scheme.type === "http" && scheme.scheme.toLowerCase() === "bearer")
      )
        request.headers.authorization = "Bearer " + value;
      else if (
        scheme.type === "http" &&
        scheme.scheme.toLowerCase() === "basic"
      )
        request.headers.authorization = "Basic " + value;
      else throw new Error("STANDARD_AUTH_SCHEME_PENDING");
    }
  }
  async run(base) {
    if (this.#closed) throw new Error("STANDARD_ENGINE_CLOSED");
    const plan = await this.plan();
    if (this.#closed) throw new Error("STANDARD_ENGINE_CLOSED");
    if (this.#busy) throw new Error("STANDARD_ENGINE_BUSY");
    this.#busy = true;
    this.#httpAbort = new AbortController();
    const records = [],
      blockers = [...plan.blockers],
      deadline = Date.now() + this.options.totalTimeout;
    const guard = new Engine("{}", { allowRemote: this.options.allowRemote });
    try {
      // Explicit base overrides servers, but is never silently inferred from a
      // remote document. Relative/templated servers are available offline below.
      const origin = guard.base(base);
      for (const test of plan.cases) {
        if (this.#closed) {
          blockers.push({ code: "engine_closed" });
          break;
        }
        const operation = this.#description.operations.find(
          (op) => op.id === test.operation_id,
        );
        if (
          !["GET", "HEAD", "OPTIONS"].includes(operation.method) &&
          !this.options.allowWrite
        ) {
          blockers.push({ case_id: test.id, code: "write_not_authorized" });
          continue;
        }
        if (Date.now() >= deadline) {
          blockers.push({ code: "total_deadline" });
          break;
        }
        let request, target;
        try {
          if (
            operation.blockers.some((b) => b === "custom_encoding_pending") ||
            operation.method === "TRACE"
          )
            throw new Error("STANDARD_ENCODING_OR_TRACE_PENDING");
          request = encodeRequest(operation, test);
          target = new URL(origin.href.replace(/\/$/, "") + request.route);
          if (target.origin !== origin.origin || target.href.length > 8192)
            throw new Error("STANDARD_TARGET_BUDGET");
          this.#auth(operation, target, request);
        } catch {
          blockers.push({
            case_id: test.id,
            code: "serialization_or_auth_blocked",
          });
          continue;
        }
        try {
          const response = await fetch(target, {
            method: operation.method,
            headers: request.headers,
            body: request.body,
            redirect: "manual",
            signal: AbortSignal.any([
              this.#httpAbort.signal,
              AbortSignal.timeout(
                Math.max(
                  1,
                  Math.min(this.options.timeout, deadline - Date.now()),
                ),
              ),
            ]),
          });
          const chunks = [];
          let bytes = 0;
          if (response.body) {
            for await (const chunk of response.body) {
              bytes += chunk.byteLength;
              if (bytes > 1048576) throw new Error("STANDARD_RESPONSE_BUDGET");
              chunks.push(chunk);
            }
          }
          const headers = Object.fromEntries(response.headers.entries());
          const media = (headers["content-type"] ?? "")
            .split(";")[0]
            .toLowerCase();
          const raw =
            media === "application/octet-stream"
              ? Buffer.concat(chunks).toString("latin1")
              : new TextDecoder("utf-8", { fatal: true }).decode(
                  Buffer.concat(chunks),
                );
          let body = raw,
            contract;
          if (
            operation.method !== "HEAD" &&
            ![204, 304].includes(response.status) &&
            (media === "application/json" || media.endsWith("+json"))
          ) {
            try {
              body = JSON.parse(raw, (key, value, context) => {
                if (
                  typeof value === "number" &&
                  (!Number.isFinite(value) ||
                    (Number.isInteger(value) && !Number.isSafeInteger(value)))
                )
                  throw new Error("STANDARD_NUMERIC_PRECISION");
                return value;
              });
            } catch {
              contract = { valid: false, code: "invalid_json_or_precision" };
            }
          }
          contract ??= await this.validateResponse(
            operation.id,
            response.status,
            body,
            headers,
            bytes === 0,
          );
          const oracle = policy("standard-oracle", {
            status: response.status,
            negative: test.negative,
            contract_valid: contract.valid,
          });
          records.push({
            case_id: test.id,
            operation_id: operation.id,
            negative: test.negative,
            status: response.status,
            ...oracle,
            contract_code: contract.code,
          });
          if (Date.now() >= deadline) {
            blockers.push({ code: "total_deadline" });
            break;
          }
        } catch {
          records.push({
            case_id: test.id,
            operation_id: operation.id,
            negative: test.negative,
            status: 0,
            ...policy("standard-oracle", {
              status: 0,
              negative: test.negative,
              contract_valid: false,
            }),
          });
        }
      }
      const failed = records.filter((r) => !r.passed).length;
      return {
        version: VERSION,
        mode: "openapi-standard",
        seed: this.options.seed,
        document_valid: true,
        planned: plan.cases.length,
        executed: records.length,
        failed,
        blockers,
        truncated: plan.truncated,
        ...policy("standard-verdict", {
          planned: plan.cases.length,
          executed: records.length,
          failed,
          blocked: blockers.length,
          truncated: plan.truncated,
        }),
        records,
      };
    } finally {
      this.#busy = false;
      this.#httpAbort = undefined;
    }
  }
  server(operationId, selection = 0, variables = {}) {
    if (this.#closed) throw new Error("STANDARD_ENGINE_CLOSED");
    const op = this.#description.operations.find((op) => op.id === operationId);
    if (!op) throw new Error("STANDARD_UNKNOWN_OPERATION");
    return resolveServer(op.servers, selection, variables);
  }
}

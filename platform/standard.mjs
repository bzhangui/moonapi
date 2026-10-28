import { Worker } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { transportAdapter, within } from "./adapters.mjs";
import { Engine, loadCore, VERSION } from "./runner.mjs";
import { encodeRequest, resolveServer } from "./standard-codec.mjs";
import {
  parseExact,
  stringifyExact,
  cloneExact,
  setOwn,
} from "./standard-value.mjs";
import { standardHTTP } from "./standard-http.mjs";
import { callbackReceiver } from "./standard-callback.mjs";
import {
  bindExpression,
  requestContext,
  expression,
} from "./standard-expression.mjs";
import { STANDARD_CAPABILITIES } from "./standard-capabilities.mjs";
import { ExecutionLedger, journalSettings } from "./execution-ledger.mjs";
import { documentDigest } from "./ci-tools.mjs";
import {
  intentEnvironmentBinding,
  intentRequestDigest,
} from "./execution-intent.mjs";

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
    this.#worker.on("message", (message) => {
      const result = parseExact(message);
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
      if (Buffer.byteLength(stringifyExact(args)) > 4194304) throw new Error();
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
        this.#worker.postMessage(stringifyExact({ id, action, args }));
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
  #codecs;
  #credentialProvider;
  #transport;
  #intentStore;
  #documentBinding;
  get description() {
    return cloneExact(this.#description);
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
      "followLinks",
      "allowCallbacks",
      "callbackTimeout",
      "linkDepth",
      "codecs",
      "documentURI",
      "credentialProvider",
      "transport",
      "intentStore",
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
      followLinks: false,
      allowCallbacks: false,
      callbackTimeout: 1000,
      linkDepth: 4,
      ...options,
    };
    for (const [key, min, max] of [
      ["seed", 0, 1000000],
      ["limit", 1, 256],
      ["timeout", 10, 30000],
      ["totalTimeout", 100, 600000],
      ["compilerTimeout", 100, 30000],
      ["callbackTimeout", 10, 30000],
      ["linkDepth", 1, 16],
    ])
      if (
        !Number.isInteger(settings[key]) ||
        settings[key] < min ||
        settings[key] > max
      )
        throw new Error("STANDARD_OPTIONS");
    for (const key of [
      "allowWrite",
      "allowRemote",
      "followLinks",
      "allowCallbacks",
    ])
      if (typeof settings[key] !== "boolean")
        throw new Error("STANDARD_OPTIONS");
    await loadCore();
    const engine = new StandardEngine();
    engine.#transport = transportAdapter(settings.transport);
    if (
      settings.intentStore !== undefined &&
      (settings.intentStore?.version !== 1 ||
        typeof settings.intentStore.prepare !== "function")
    )
      throw new Error("STANDARD_INTENT_STORE");
    engine.#intentStore = settings.intentStore;
    engine.#documentBinding = documentDigest(source, settings.documents);
    if (
      settings.credentialProvider !== undefined &&
      (settings.credentialProvider?.version !== 1 ||
        typeof settings.credentialProvider.resolve !== "function")
    )
      throw new Error("STANDARD_CREDENTIAL_PROVIDER");
    engine.#credentialProvider = settings.credentialProvider;
    engine.#codecs = new Map();
    for (const [media, codec] of Object.entries(settings.codecs || {})) {
      if (
        !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(media) ||
        typeof codec?.encode !== "function" ||
        typeof codec?.decode !== "function"
      )
        throw new Error("STANDARD_CODEC_CONFIGURATION");
      engine.#codecs.set(
        media.toLowerCase(),
        Object.freeze({ encode: codec.encode, decode: codec.decode }),
      );
    }
    Object.defineProperty(engine, "options", {
      value: Object.freeze({
        seed: settings.seed,
        limit: settings.limit,
        allowWrite: settings.allowWrite,
        allowRemote: settings.allowRemote,
        timeout: settings.timeout,
        totalTimeout: settings.totalTimeout,
        followLinks: settings.followLinks,
        allowCallbacks: settings.allowCallbacks,
        callbackTimeout: settings.callbackTimeout,
        linkDepth: settings.linkDepth,
      }),
      writable: false,
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
        documentURI: settings.documentURI,
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
    if (this.#plan) return cloneExact(this.#plan);
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
        ...STANDARD_CAPABILITIES,
      };
      return cloneExact(this.#plan);
    } finally {
      this.#busy = false;
    }
  }
  async validateRequest(test) {
    if (this.#closed) throw new Error("STANDARD_ENGINE_CLOSED");
    return this.#worker.call("request", { id: test.operation_id, test });
  }
  async profiles() {
    if (this.#closed) throw new Error("STANDARD_ENGINE_CLOSED");
    return this.#worker.call("profiles", {});
  }
  async runSelected(
    base,
    { operationIds, priority = [], journalDirectory, journalOptions } = {},
  ) {
    const plan = await this.plan();
    const known = new Set(this.description.operations.map((o) => o.id));
    if (
      !Array.isArray(operationIds) ||
      !operationIds.length ||
      new Set(operationIds).size !== operationIds.length ||
      operationIds.some((id) => !known.has(id)) ||
      !Array.isArray(priority) ||
      priority.some((id) => !known.has(id))
    )
      throw new Error("STANDARD_SELECTION");
    const cases = plan.cases.filter((c) =>
      operationIds.includes(c.operation_id),
    );
    cases.sort(
      (a, b) =>
        Number(priority.includes(b.operation_id)) -
        Number(priority.includes(a.operation_id)),
    );
    const report = await this.#runLogged(
      base,
      {
        ...plan,
        cases,
        blockers: plan.blockers.filter(
          (b) => !b.operation_id || operationIds.includes(b.operation_id),
        ),
      },
      journalDirectory,
      journalOptions,
    );
    return {
      ...report,
      selection: {
        selected: operationIds.length,
        total: known.size,
        full_suite: operationIds.length === known.size,
      },
    };
  }
  async resolveLinks(id, context) {
    if (this.#closed) throw new Error("STANDARD_ENGINE_CLOSED");
    return this.#worker.call("links", { id, context, seed: this.options.seed });
  }
  async validateCallback(id, name, expression, incoming) {
    if (this.#closed) throw new Error("STANDARD_ENGINE_CLOSED");
    return this.#worker.call("callback", {
      id,
      name,
      expression,
      incoming,
      seed: this.options.seed,
      credentials: this.#credentials,
    });
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
  #auth(operation, target, request, credentials = this.#credentials) {
    if (
      !operation.security.length ||
      operation.security.some((r) => Object.keys(r).length === 0)
    )
      return;
    const alternative = operation.security.find((requirement) =>
      Object.entries(requirement).every(([name, scopes]) => {
        const credential = Object.hasOwn(credentials, name)
          ? credentials[name]
          : undefined;
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
        credential = credentials[name];
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
          : (scheme.type === "http"
              ? scheme.scheme.toLowerCase() === "basic"
                ? "Basic"
                : scheme.scheme.toLowerCase() === "bearer"
                  ? "Bearer"
                  : scheme.scheme
              : "Bearer") +
              " " +
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
          setOwn(request.headers, scheme.name.toLowerCase(), value);
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
      else if (scheme.type === "http")
        request.headers.authorization = scheme.scheme + " " + value;
      else throw new Error("STANDARD_AUTH_SCHEME");
    }
  }
  async #runLogged(base, plan, journalDirectory, journalOptions) {
    const ledger = await ExecutionLedger.open({
      ...journalSettings(journalOptions),
      directory: journalDirectory,
    });
    let attempt = 0;
    try {
      const report = await this.#run(base, {
        ...plan,
        onEvent: (e) => {
          if (e.state === "prepared") attempt++;
          ledger.event(attempt, e.state, e);
        },
      });
      return { ...report, execution: ledger.summary() };
    } finally {
      ledger.close();
    }
  }
  async run(base, { journalDirectory, journalOptions } = {}) {
    return this.#runLogged(
      base,
      await this.plan(),
      journalDirectory,
      journalOptions,
    );
  }
  // Explicit in-process observation API. Context may contain secrets; it is
  // never part of run()'s public summary or persisted by the engine.
  async execute(
    base,
    input,
    {
      deadline,
      remainingMs,
      expectedStatuses,
      onEvent,
      role,
      authorizationProbe = false,
    } = {},
  ) {
    if (
      typeof authorizationProbe !== "boolean" ||
      (role !== undefined && !/^[a-zA-Z0-9_.-]{1,64}$/.test(role))
    )
      throw new Error("STANDARD_ROLE");
    if (
      remainingMs !== undefined &&
      (!Number.isFinite(remainingMs) || remainingMs < 0 || remainingMs > 600000)
    )
      throw new Error("STANDARD_EXECUTION_DEADLINE");
    if (onEvent !== undefined && typeof onEvent !== "function")
      throw new Error("STANDARD_OBSERVER");
    if (
      expectedStatuses !== undefined &&
      (!Array.isArray(expectedStatuses) ||
        !expectedStatuses.length ||
        expectedStatuses.length > 16 ||
        expectedStatuses.some(
          (s) =>
            !Number.isInteger(s) ||
            s < 200 ||
            s >= 500 ||
            s === 429 ||
            (!authorizationProbe && [401, 403].includes(s)),
        ))
    )
      throw new Error("STANDARD_EXPECTED_STATUSES");
    if (
      deadline !== undefined &&
      (!Number.isSafeInteger(deadline) || deadline < 0)
    )
      throw new Error("STANDARD_EXECUTION_DEADLINE");
    const test = cloneExact(input);
    if (
      !test ||
      typeof test !== "object" ||
      !Array.isArray(test.parameters) ||
      !this.#description.operations.some((o) => o.id === test.operation_id) ||
      typeof test.negative !== "boolean"
    )
      throw new Error("STANDARD_CASE_IR");
    if ((await this.validateRequest(test)).valid !== !test.negative)
      throw new Error("STANDARD_CASE_CONTRACT");
    test.id = "workflow-case";
    const observed = [];
    const report = await this.#run(
      base,
      {
        cases: [test],
        blockers: [],
        truncated: false,
        deadline,
        remainingMs: Math.max(
          0,
          Math.min(
            remainingMs ?? Infinity,
            deadline === undefined ? Infinity : deadline - Date.now(),
          ),
        ),
        onEvent,
        role,
        authorizationProbe,
        expectedStatuses,
      },
      observed,
    );
    return {
      record: report.records[0],
      blockers: report.blockers,
      context: observed[0],
    };
  }
  async #run(base, customPlan, observed) {
    if (this.#closed) throw new Error("STANDARD_ENGINE_CLOSED");
    const plan = customPlan ?? (await this.plan());
    if (this.#closed) throw new Error("STANDARD_ENGINE_CLOSED");
    if (this.#busy) throw new Error("STANDARD_ENGINE_BUSY");
    this.#busy = true;
    this.#httpAbort = new AbortController();
    const records = [],
      blockers = [...plan.blockers],
      deadline = Math.min(
        performance.now() + this.options.totalTimeout,
        performance.now() + (customPlan?.remainingMs ?? Infinity),
      );
    const deadlineSignal = AbortSignal.timeout(
      Math.ceil(Math.max(1, deadline - performance.now())),
    );
    const budgetSignal = AbortSignal.any([
      this.#httpAbort.signal,
      deadlineSignal,
    ]);
    const wait = (fn) => within(budgetSignal, fn, "STANDARD_TOTAL_DEADLINE");
    const guard = new Engine("{}", { allowRemote: this.options.allowRemote });
    try {
      // Explicit base overrides servers, but is never silently inferred from a
      // remote document. Relative/templated servers are available offline below.
      const origin = guard.base(base);
      const queue = cloneExact(plan.cases),
        linkedSeen = new Set();
      for (const test of queue) {
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
        if (performance.now() >= deadline) {
          blockers.push({ code: "total_deadline" });
          break;
        }
        let request,
          target,
          totalSignal,
          credentials = this.#credentials;
        let phase = "";
        const emit = (state, status = 0) => {
          if (state === "sent" && phase !== "dispatching") return;
          const result = customPlan?.onEvent?.({
            state,
            method: operation.method,
            operation_id: operation.id,
            status,
          });
          if (result && typeof result.then === "function")
            throw new Error("STANDARD_OBSERVER_MUST_BE_SYNCHRONOUS");
          phase = state;
        };
        const receivers = [];
        emit("prepared");
        try {
          if (this.#credentialProvider) {
            const signal = AbortSignal.any([
              this.#httpAbort.signal,
              AbortSignal.timeout(
                Math.ceil(Math.max(1, deadline - performance.now())),
              ),
            ]);
            credentials = await within(
              signal,
              () =>
                this.#credentialProvider.resolve({
                  operation_id: operation.id,
                  method: operation.method,
                  role: customPlan?.role || "default",
                  signal,
                }),
              "STANDARD_CREDENTIAL_DEADLINE",
            );
            if (
              !credentials ||
              typeof credentials !== "object" ||
              Array.isArray(credentials) ||
              Buffer.byteLength(JSON.stringify(credentials)) > 16384
            )
              throw new Error("STANDARD_CREDENTIAL_PROVIDER_RESULT");
          }
          if (operation.callbacks.length) {
            if (!this.options.allowCallbacks)
              throw new Error("STANDARD_CALLBACK_NOT_AUTHORIZED");
            const declared = await this.#worker.call("callbacks", {
              id: operation.id,
            });
            for (const callback of declared) {
              if (test.negative) {
                const value = expression(callback.expression, {
                  request: requestContext(test),
                });
                if (value === undefined) continue;
                try {
                  new URL(value);
                } catch {
                  continue;
                }
              }
              const receiver = await callbackReceiver(
                (incoming) =>
                  this.#worker.call("callback", {
                    id: operation.id,
                    ...callback,
                    incoming,
                    seed: this.options.seed,
                    credentials,
                  }),
                Math.min(
                  this.options.callbackTimeout,
                  Math.max(10, deadline - performance.now()),
                ),
              );
              receivers.push(receiver);
              if (!bindExpression(test, callback.expression, receiver.url))
                throw new Error("STANDARD_CALLBACK_BINDING_REQUIRED");
            }
            if ((await this.validateRequest(test)).valid === test.negative)
              throw new Error("STANDARD_CALLBACK_BINDING_SCHEMA");
          }
          request = await this.#worker.call("encode", {
            id: operation.id,
            test,
          });
          if (request.body !== undefined)
            request.body = Buffer.from(request.body, "base64");
          const encoder = this.#codecs.get(
            test.media?.split(";")[0].toLowerCase(),
          );
          if (encoder && Object.hasOwn(test, "body")) {
            request.body = Buffer.from(
              await wait(() =>
                encoder.encode(cloneExact(test.body), budgetSignal),
              ),
            );
            if (request.body.length > 262144)
              throw new Error("STANDARD_REQUEST_BUDGET");
            request.headers["content-type"] = test.media;
          }
          const baseURL = test.link_server
            ? new URL(resolveServer([test.link_server]), origin)
            : origin;
          guard.base(baseURL.href);
          if (baseURL.origin !== origin.origin)
            throw new Error("STANDARD_LINK_ORIGIN_NOT_AUTHORIZED");
          target = new URL(baseURL.href.replace(/\/$/, "") + request.route);
          if (target.origin !== origin.origin || target.href.length > 8192)
            throw new Error("STANDARD_TARGET_BUDGET");
          this.#auth(operation, target, request, credentials);
          const wireContract = await this.#worker.call("wire-request", {
            id: operation.id,
            route: request.route,
            headers: request.headers,
            raw: request.body?.toString("base64"),
            decodedBody:
              encoder && request.body
                ? await wait(() => encoder.decode(request.body, budgetSignal))
                : undefined,
          });
          if (wireContract.valid !== !test.negative)
            throw new Error("STANDARD_WIRE_CONTRACT_MISMATCH");
          if (
            this.#intentStore &&
            !["GET", "HEAD", "OPTIONS"].includes(operation.method)
          ) {
            const receipt = await wait(() =>
              this.#intentStore.prepare(
                {
                  method: operation.method,
                  operationId: operation.id,
                  environmentBinding: intentEnvironmentBinding(origin.href),
                  documentBinding: this.#documentBinding,
                  requestDigest: intentRequestDigest(
                    operation.method,
                    target,
                    request,
                  ),
                },
                budgetSignal,
              ),
            );
            if (
              receipt?.durable !== true ||
              receipt.automatic_replay_permitted !== false
            )
              throw new Error("STANDARD_INTENT_NOT_DURABLE");
          }
        } catch (error) {
          emit("blocked");
          for (const receiver of receivers) await receiver.close();
          if (
            error.message === "STANDARD_TOTAL_DEADLINE" ||
            performance.now() >= deadline
          ) {
            blockers.push({ code: "total_deadline" });
            break;
          }
          blockers.push({
            case_id: test.id,
            code: "serialization_or_auth_blocked",
            reason: /^STANDARD_[A-Z_]+$/.test(error.message)
              ? error.message
              : "STANDARD_SERIALIZATION",
          });
          continue;
        }
        try {
          emit("dispatching");
          totalSignal = AbortSignal.timeout(
            Math.ceil(Math.max(1, deadline - performance.now())),
          );
          const response = await this.#transport.send(target, {
            method: operation.method,
            headers: request.headers,
            body: request.body,
            onSent: () => emit("sent"),
            signal: AbortSignal.any([
              this.#httpAbort.signal,
              totalSignal,
              AbortSignal.timeout(this.options.timeout),
            ]),
          });
          emit("responded", response.status);
          const decoder = this.#codecs.get(
            response.headers["content-type"]
              ?.split(";")[0]
              .trim()
              .toLowerCase(),
          );
          const decodedBody = decoder
            ? await wait(() => decoder.decode(response.raw, budgetSignal))
            : undefined;
          const decoded = decoder
            ? {
                body: decodedBody,
                contract: await this.validateResponse(
                  operation.id,
                  response.status,
                  decodedBody,
                  response.headers,
                  response.raw.length === 0,
                ),
              }
            : await this.#worker.call("decode", {
                id: operation.id,
                status: response.status,
                headers: response.headers,
                raw: response.raw.toString("base64"),
              });
          let body = decoded.body,
            contract = decoded.contract;
          const oracle = policy("standard-oracle", {
            status: response.status,
            negative: test.negative,
            contract_valid: contract.valid,
          });
          if (
            customPlan?.expectedStatuses &&
            contract.valid &&
            response.status < 500 &&
            response.status !== 429 &&
            (customPlan?.authorizationProbe ||
              ![401, 403].includes(response.status))
          ) {
            oracle.passed = customPlan.expectedStatuses.includes(
              response.status,
            );
            oracle.code = oracle.passed ? "" : "business_status";
            oracle.fingerprint = oracle.passed
              ? ""
              : `${response.status}:business_status`;
          }
          let callbacksValid = true;
          for (const receiver of receivers)
            if (
              test.negative
                ? receiver.records.length > 0
                : !(await receiver.settle())
            )
              callbacksValid = false;
          if (!callbacksValid) {
            oracle.passed = false;
            oracle.code = receivers.some((r) => r.records.some((x) => !x.valid))
              ? "callback_contract"
              : "callback_timeout";
            oracle.inconclusive = oracle.code === "callback_timeout";
            oracle.fingerprint = String(response.status) + ":" + oracle.code;
          }
          emit(oracle.passed ? "completed" : "failed", response.status);
          records.push({
            case_id: test.id,
            operation_id: operation.id,
            negative: test.negative,
            status: response.status,
            ...oracle,
            contract_code: contract.code,
            category: policy("workflow-category", { code: oracle.code }),
            ...(receivers.length
              ? {
                  callback_count: receivers.reduce(
                    (n, r) => n + r.records.length,
                    0,
                  ),
                  callbacks_valid: callbacksValid,
                }
              : {}),
          });
          observed?.push({
            url: target.href,
            method: operation.method,
            status: response.status,
            request: requestContext(test, request.headers),
            response: { body, header: response.headers },
          });
          if (
            !observed &&
            this.options.followLinks &&
            !test.negative &&
            contract.valid
          ) {
            try {
              const links = await this.resolveLinks(operation.id, {
                url: target.href,
                method: operation.method,
                status: response.status,
                request: requestContext(test, request.headers),
                response: { body, header: response.headers },
              });
              for (const link of links) {
                if (!link.test || !link.valid) {
                  blockers.push({
                    case_id: test.id,
                    code: link.code || "link_expression_or_contract",
                  });
                  continue;
                }
                const signature = stringifyExact({
                  test: link.test,
                  server: link.server,
                });
                if (linkedSeen.has(signature)) continue;
                linkedSeen.add(signature);
                if ((test.link_depth || 0) >= this.options.linkDepth) {
                  blockers.push({ code: "link_depth_budget" });
                  continue;
                }
                if (
                  !this.#description.operations.some(
                    (o) => o.id === link.operation.id,
                  )
                )
                  this.#description.operations.push(link.operation);
                if (queue.length >= this.options.limit) {
                  blockers.push({ code: "link_case_budget" });
                  break;
                }
                queue.push({
                  ...link.test,
                  id: `link-${queue.length + 1}`,
                  link_depth: (test.link_depth || 0) + 1,
                  link_server: link.server,
                });
              }
            } catch (error) {
              blockers.push({
                case_id: test.id,
                code: "link_resolution_blocked",
                reason: /^STANDARD_[A-Z_]+$/.test(error.message)
                  ? error.message
                  : "STANDARD_LINK_RESOLUTION",
              });
            }
          }
          if (performance.now() >= deadline) {
            blockers.push({ code: "total_deadline" });
            break;
          }
        } catch {
          if (["dispatching", "sent", "responded"].includes(phase))
            emit("unknown");
          const expired =
            deadlineSignal.aborted ||
            totalSignal?.aborted ||
            performance.now() >= deadline;
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
            ...(expired ? { code: "total_deadline" } : {}),
            category: expired ? "budget" : "transport",
          });
          if (
            !["GET", "HEAD", "OPTIONS"].includes(operation.method) &&
            phase === "unknown"
          ) {
            blockers.push({ code: "unknown_write_requires_inspection" });
            break;
          }
        } finally {
          for (const receiver of receivers) await receiver.close();
        }
      }
      const failed = records.filter((r) => !r.passed).length;
      return {
        version: VERSION,
        mode: "openapi-standard",
        coverage_policy: {
          links: this.options.followLinks,
          callbacks: this.options.allowCallbacks,
          case_budget: this.options.limit,
        },
        seed: this.options.seed,
        document_valid: true,
        planned: queue.length,
        executed: records.length,
        failed,
        blockers,
        truncated: plan.truncated,
        ...policy("standard-verdict", {
          planned: queue.length,
          executed: records.length,
          failed,
          blocked: blockers.length,
          truncated: plan.truncated,
        }),
        records,
        ...STANDARD_CAPABILITIES,
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

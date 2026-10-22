import { randomBytes } from "node:crypto";
import { BehaviorEngine } from "./behavior.mjs";

// Not a general transaction manager. Scope is one freshly created resource,
// fenced by a captured ID and a per-run random marker checked before mutation.
export class OwnedCrudEngine extends BehaviorEngine {
  #active = false;
  #session;
  planCrud(collection, field) {
    if (typeof collection !== "string" || typeof field !== "string")
      throw new Error("Explicit collection and field required");
    return this.engine.command("crud-plan", {
      collection,
      field,
      marker: "moonapi_" + randomBytes(12).toString("hex"),
      changed: "moonapi_" + randomBytes(12).toString("hex"),
    });
  }
  #case(operationId, id) {
    const s = this.#session;
    return this.engine.command("scenario", {
      step: { operationId, parameters: { [s.plan.parameter]: id } },
      bindings: {},
    }).case;
  }
  async #read(id, deadline, signal) {
    const s = this.#session;
    const seen = await this.engine.observe(
      s.base,
      this.#case(s.plan.read, id),
      deadline,
      signal,
    );
    s.http++;
    return seen;
  }
  #matches(seen, id) {
    const s = this.#session,
      body = seen.body;
    return (
      seen.status === 200 &&
      seen.finding.passed &&
      body?.id === id &&
      s.markers.has(body?.[s.plan.field])
    );
  }
  async #cleanup(signal) {
    const s = this.#session;
    // Cleanup has a separate bounded grace period: total test expiry must not
    // suppress best-effort cleanup, nor turn it into an unbounded retry loop.
    const deadline = Date.now() + this.engine.options.timeout * 3;
    for (const id of [...s.owned]) {
      const before = await this.#read(id, deadline, signal);
      if (before.status === 404 && before.finding.passed) {
        s.owned.delete(id);
        continue;
      }
      if (!this.#matches(before, id)) return false;
      const seen = await this.engine.observe(
        s.base,
        this.#case(s.plan.delete, id),
        deadline,
        signal,
      );
      s.http++;
      if (![200, 204].includes(seen.status) || !seen.finding.passed)
        return false;
      const after = await this.#read(id, deadline, signal);
      if (after.status !== 404 || !after.finding.passed) return false;
      s.owned.delete(id);
    }
    return !s.uncertain;
  }
  async observe(base, test, deadline) {
    const s = this.#session;
    if (!s) throw new Error("Owned CRUD session required");
    const op = test.operation_id;
    if ([s.plan.update, s.plan.delete].includes(op)) {
      const id = test.parameters.find((p) => p.in === "path")?.value;
      if (
        !s.owned.has(id) ||
        !this.#matches(await this.#read(id, deadline), id)
      )
        throw new Error("Ownership fence refused mutation");
    }
    if (op === s.plan.create && (s.owned.size || s.uncertain))
      throw new Error("Unclean replay refused");
    const seen = await this.engine.observe(base, test, deadline);
    s.http++;
    if (op === s.plan.create) {
      const body = seen.body,
        id = body?.id;
      const validId =
        s.plan.id_schema.type === "integer"
          ? Number.isSafeInteger(id)
          : typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id);
      if (
        seen.status === s.plan.create_status &&
        validId &&
        s.markers.has(body?.[s.plan.field])
      )
        s.owned.add(id);
      else s.uncertain = true;
    }
    return seen;
  }
  async runCrud(base, collection, field, options = {}) {
    if (
      !options ||
      Object.getPrototypeOf(options) !== Object.prototype ||
      Reflect.ownKeys(options).some(
        (k) => !["allowCleanup", "saveRepro"].includes(k),
      ) ||
      Object.values(Object.getOwnPropertyDescriptors(options)).some(
        (d) => d.get || d.set,
      ) ||
      options.allowCleanup !== true ||
      (options.saveRepro !== undefined &&
        typeof options.saveRepro !== "boolean")
    )
      throw new Error(
        "Explicit allowCleanup required; only saveRepro is optional",
      );
    if (this.#active) throw new Error("Concurrent use of one runner refused");
    if (!this.engine.options.allowWrite)
      throw new Error("CRUD writes require allowWrite");
    this.engine.base(base);
    const plan = this.planCrud(collection, field);
    this.plan(plan.trace, { checkPermissions: true });
    this.#active = true;
    const s = (this.#session = {
      base,
      plan,
      owned: new Set(),
      uncertain: false,
      http: 0,
      markers: new Set([
        plan.trace.steps[0].body[field],
        plan.trace.steps[2].body[field],
      ]),
    });
    let report,
      cleaned = false;
    try {
      report = await super.run(base, plan.trace, {
        reset: async ({ signal }) => this.#cleanup(signal),
        allowReset: true,
        saveRepro: options.saveRepro ?? false,
      });
    } finally {
      try {
        cleaned = await this.#cleanup();
      } catch {
        cleaned = false;
      }
      this.#active = false;
      this.#session = undefined;
    }
    return {
      ...report,
      mode: "owned_resource_crud",
      profile: plan.profile,
      full_openapi_support: false,
      reset_isolation: "owned_resource_only_no_global_reset",
      complete: report.complete && cleaned,
      cleanup_verified: cleaned,
      unclaimed_write_possible: s.uncertain,
      remaining_owned_count: s.owned.size,
      http_requests: s.http,
      cleanup_grace_max_ms: this.engine.options.timeout * 3,
      // No IDs, marker values, bodies, paths, or environment data in this receipt.
      global_business_isolation: false,
      real_user_pilot: false,
    };
  }
}

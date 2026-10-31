// A least-privilege invocation contract, not a sandbox for untrusted JS.
import { within } from "./adapters.mjs";
export function scopedCredentials(
  provider,
  { documentBinding, environmentBinding, roles, operations },
) {
  const digest = (s) => typeof s === "string" && /^[0-9a-f]{64}$/.test(s);
  const names = (v, max, pattern) =>
    Array.isArray(v) &&
    v.length > 0 &&
    v.length <= max &&
    new Set(v).size === v.length &&
    v.every((s) => typeof s === "string" && pattern.test(s));
  if (
    provider?.version !== 1 ||
    typeof provider.resolve !== "function" ||
    !digest(documentBinding) ||
    !digest(environmentBinding) ||
    !names(roles, 32, /^[A-Za-z0-9_.-]{1,64}$/) ||
    !names(operations, 256, /^[\s\S]{1,256}$/)
  )
    throw new Error("CREDENTIAL_SCOPE_CONFIG");
  const roleSet = new Set(roles),
    operationSet = new Set(operations);
  return Object.freeze({
    version: 1,
    id: "scoped-credential-v1",
    async resolve(context) {
      if (
        !context ||
        context.documentBinding !== documentBinding ||
        context.environmentBinding !== environmentBinding ||
        !roleSet.has(context.role) ||
        !operationSet.has(context.operation_id) ||
        context.signal?.aborted
      )
        throw new Error("CREDENTIAL_SCOPE_DENIED");
      const value = await within(
        context.signal,
        () => provider.resolve(Object.freeze({ ...context })),
        "CREDENTIAL_SCOPE_DEADLINE",
      );
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
        Buffer.byteLength(JSON.stringify(value)) > 16384
      )
        throw new Error("CREDENTIAL_SCOPE_RESPONSE");
      return structuredClone(value);
    },
  });
}

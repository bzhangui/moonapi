// Capability declaration, not a result inferred from a sampled green run.
// The independent vectors, OAS semantic tests and real HTTP controls in CI
// jointly guard this declaration. Legacy portable profiles remain bounded.
export const STANDARD_CAPABILITIES = Object.freeze({
  specification: "OpenAPI 3.0 (3.0.4 normative clarifications)",
  full_openapi_support: true,
  third_party_certification: false,
  document_formats: Object.freeze(["JSON", "YAML 1.2"]),
  execution_requires_explicit_authorization: true,
  exhaustive_business_coverage: false,
});
export function capabilitiesFor(version) {
  if (!version || version.startsWith("3.0.")) return STANDARD_CAPABILITIES;
  return {
    ...STANDARD_CAPABILITIES,
    specification: "OpenAPI " + version,
    openapi_version: version,
    full_openapi_support: /^3\.[12]\.\d+$/.test(version),
    modern_execution_supported: /^3\.[12]\.\d+$/.test(version),
    implementation_status: /^3\.[12]\.\d+$/.test(version)
      ? "native-standard"
      : "unsupported-version",
    normative_baseline: version.startsWith("3.1.")
      ? "3.1.2"
      : version.startsWith("3.2.")
        ? "3.2.1"
        : undefined,
  };
}

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

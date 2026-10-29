// Isolated document inspection, never routes requests or projects 3.1/3.2 to 3.0.
import { parentPort } from "node:worker_threads";
import {
  Source,
  BaseResolver,
  createConfig,
  lintDocument,
} from "@redocly/openapi-core";
import { parseDefinition } from "./definition.mjs";
import { shadow } from "./standard-value.mjs";
import { prepareModernDocument } from "./modern-document.mjs";
import { modernSchemaTools } from "./modern-generation.mjs";
import { capabilitiesFor } from "./standard-capabilities.mjs";
parentPort.once("message", async ({ source, documents }) => {
  try {
    const parsed = parseDefinition(source),
      version = parsed.openapi;
    if (!/^3\.(?:0|1|2)\.\d+$/.test(version))
      throw new Error("DIALECT_VERSION");
    const root = "https://moonapi.invalid/openapi.json",
      map = new Map();
    if (
      !documents ||
      typeof documents !== "object" ||
      Array.isArray(documents) ||
      Object.keys(documents).length > 16
    )
      throw new Error("DIALECT_REFERENCES");
    let bytes = Buffer.byteLength(source);
    for (const [uri, text] of Object.entries(documents)) {
      if (
        typeof text !== "string" ||
        (bytes += Buffer.byteLength(text)) > 4194304
      )
        throw new Error("DIALECT_REFERENCES");
      const absolute = new URL(uri, root).href;
      if (new URL(absolute).hash || map.has(absolute))
        throw new Error("DIALECT_REFERENCES");
      map.set(absolute, text);
    }
    const capabilities = capabilitiesFor(version);
    if (/^3\.[12]\.\d+$/.test(version)) {
      let structurally_valid = false;
      try {
        const prepared = await prepareModernDocument(source, {
          documents: Object.fromEntries(map),
          documentURI: root,
        });
        const tools = modernSchemaTools(prepared);
        // Unused components are still part of the declared document. Compile
        // them too, with their own physical URI and inherited native dialect.
        for (const item of prepared.schemaRoots) tools.compile(item.schema);
        structurally_valid = true;
      } catch {
        // Errors may contain private URI fragments, values or annotations.
        // Inspection reports the category, never the original diagnostic text.
      }
      parentPort.postMessage({
        version,
        ...capabilities,
        structurally_valid,
        issues: structurally_valid
          ? []
          : [{ rule: "native-document-or-schema", severity: "error" }],
        structural_inspector: "native-oas-document-and-2020-12",
        execution_supported: capabilities.modern_execution_supported === true,
        modern_execution_validated: structurally_valid,
        full_dialect_conformance_certified: false,
        reference_access: "explicit_document_map_only",
        contents_hidden: true,
      });
      return;
    }
    class GrantedResolver extends BaseResolver {
      async loadExternalRef(uri) {
        if (!map.has(uri)) throw new Error("DIALECT_REFERENCE_NOT_GRANTED");
        return new Source(uri, map.get(uri));
      }
      parseDocument(s) {
        return { source: s, parsed: shadow(parseDefinition(s.body)) };
      }
    }
    const resolver = new GrantedResolver(),
      config = await createConfig({
        rules: { struct: "error", "no-unresolved-refs": "error" },
      });
    const problems = await lintDocument({
      document: { source: new Source(root, source), parsed: shadow(parsed) },
      config,
      externalRefResolver: resolver,
    });
    parentPort.postMessage({
      version,
      ...capabilities,
      structurally_valid: !problems.some((p) => p.severity === "error"),
      issues: problems
        .slice(0, 128)
        .map((p) => ({ rule: p.ruleId, severity: p.severity })),
      structural_inspector: "redocly-2.71.1",
      execution_supported: true,
      modern_execution_validated: false,
      full_dialect_conformance_certified: false,
      reference_access: "explicit_document_map_only",
    });
  } catch {
    parentPort.postMessage({
      error: "DIALECT_INVALID_OR_UNGRANTED",
      contents_hidden: true,
    });
  }
});

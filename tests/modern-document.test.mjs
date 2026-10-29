import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareModernDocument,
  modernMethods,
} from "../platform/modern-document.mjs";
import { stringifyExact, parseExact } from "../platform/standard-value.mjs";

const base = (version = "3.2.1") => ({
  openapi: version,
  info: { title: "synthetic modern API", version: "1" },
  paths: {
    "/items": {
      get: {
        operationId: "list",
        responses: {
          200: {
            description: "ok",
            content: {
              "application/json": {
                schema: { type: "array", items: { type: "integer" } },
              },
            },
          },
        },
      },
    },
  },
});

test("native 3.1/3.2 documents retain version, boolean schemas and exact ref siblings", async () => {
  for (const version of ["3.1.2", "3.2.1"]) {
    const doc = base(version);
    doc.components = {
      schemas: {
        Never: false,
        Any: true,
        Identity: {
          type: ["integer", "null"],
          $ref: "#/components/schemas/Identity/$defs/unused",
          $defs: { unused: { minimum: 1 } },
          maximum: 9223372036854776000,
        },
      },
    };
    const prepared = await prepareModernDocument(JSON.stringify(doc));
    assert.equal(prepared.definition.openapi, version);
    assert.equal(
      prepared.defaultDialect,
      version.startsWith("3.1.")
        ? "https://spec.openapis.org/oas/3.1/dialect/2024-11-10"
        : "https://spec.openapis.org/oas/3.2/dialect/2026-02-26",
    );
    assert.equal(prepared.definition.components.schemas.Never, false);
    assert.equal(
      prepared.definition.components.schemas.Identity.$ref,
      "#/components/schemas/Identity/$defs/unused",
    );
    assert.ok(
      prepared.schemaRegistry.has(
        "https://moonapi.invalid/openapi.json#%2Fcomponents%2Fschemas%2FIdentity",
      ),
    );
    assert.equal(prepared.operations[0].method, "GET");
    assert.equal(prepared.operations[0].zone, "paths");
  }
});

test("self identities and granted external OAD references preserve origin base and annotations", async () => {
  const doc = base();
  doc.$self = "https://api.invalid/root/openapi.yaml";
  doc.paths["/items"].get.parameters = [
    {
      $ref: "parts/params.yaml#/components/parameters/Limit",
      description: "override",
      required: true,
    },
  ];
  const external = {
    openapi: "3.2.1",
    $self: "https://api.invalid/root/parts/params.yaml",
    info: { title: "parts", version: "1" },
    components: {
      parameters: {
        Limit: {
          in: "query",
          name: "limit",
          description: "base",
          required: false,
          schema: { type: "integer", minimum: 9223372036854775807n.toString() },
        },
      },
    },
  };
  external.components.parameters.Limit.schema = parseExact(
    '{"type":"integer","minimum":9223372036854775807}',
  );
  const r = await prepareModernDocument(JSON.stringify(doc), {
    documentURI: "file:///private/root.yaml",
    documents: { "https://provided.invalid/p.yaml": stringifyExact(external) },
  });
  const p = r.definition.paths["/items"].get.parameters[0];
  assert.equal(p.description, "override");
  assert.equal(p.required, false);
  assert.equal(String(p.schema.minimum), "9223372036854775807");
  assert.equal(
    r.schemaLocations.get(p.schema).base,
    "https://api.invalid/root/parts/params.yaml",
  );
  assert.equal(r.documentURI, doc.$self);
});

test("3.2 QUERY/additional methods, inbound webhooks, callback maps and media references are indexed", async () => {
  const doc = base(),
    response = { 200: { description: "ok" } };
  doc.paths["/items"].query = { operationId: "search", responses: response };
  doc.paths["/items"].additionalOperations = {
    COPY: { operationId: "copy", responses: response },
  };
  doc.webhooks = {
    changed: {
      post: {
        operationId: "changed",
        requestBody: { content: { "application/json": { schema: true } } },
        responses: response,
      },
    },
  };
  doc.components = { mediaTypes: { Payload: { schema: { type: "string" } } } };
  doc.paths["/items"].get.responses["200"].content["application/json"] = {
    $ref: "#/components/mediaTypes/Payload",
  };
  doc.paths["/items"].get.callbacks = {
    notify: {
      "{$request.body#/callback}": {
        post: { operationId: "notify", responses: response },
      },
    },
  };
  const r = await prepareModernDocument(JSON.stringify(doc));
  assert.deepEqual(
    r.operations.map((o) => o.method),
    ["GET", "QUERY", "COPY"],
  );
  assert.equal(r.webhookOperations.length, 1);
  assert.equal(r.webhookOperations[0].zone, "webhooks");
  const callback = r.definition.paths["/items"].get.callbacks.notify;
  assert.equal(r.callbackOperations.get(callback)[0].method, "POST");
  assert.equal(
    r.definition.paths["/items"].get.responses["200"].content[
      "application/json"
    ].schema.type,
    "string",
  );
});

test("literal references inside examples/extensions are inert and prototype-named data stays own", async () => {
  const doc = base();
  doc.paths["/items"].get.responses["200"].content["application/json"] = {
    schema: { type: "object", properties: { __proto__: { type: "string" } } },
    examples: {
      literal: {
        dataValue: parseExact(
          '{"$ref":"file:///not-granted/private","__proto__":{"polluted":true},"hasOwnProperty":"data"}',
        ),
      },
    },
  };
  doc["x-opaque"] = { $ref: "https://not-granted.invalid/private", servers: 1 };
  doc.paths["/items"].get.responses["200"].headers = {
    hasOwnProperty: { schema: { type: "string" } },
    constructor: { schema: { type: "string" } },
  };
  doc.paths["x-details"] = "opaque path metadata";
  doc.paths["/items"].get.responses["x-description"] = {
    servers: "opaque response metadata",
  };
  const r = await prepareModernDocument(JSON.stringify(doc));
  const value =
    r.definition.paths["/items"].get.responses["200"].content[
      "application/json"
    ].examples.literal.dataValue;
  assert.equal(value.$ref, "file:///not-granted/private");
  assert.equal(Object.hasOwn(value, "__proto__"), true);
  assert.equal({}.polluted, undefined);
  assert.equal(
    r.definition.paths["/items"].get.responses["200"].headers.hasOwnProperty
      .schema.type,
    "string",
  );
});

test("querystring conflicts, duplicate methods/path templates and inherited parameters fail before execution", async () => {
  const cases = [];
  let doc = base();
  doc.paths["/items"].additionalOperations = { GET: { responses: {} } };
  cases.push([doc, /ADDITIONAL_METHOD/]);
  doc = base();
  doc.paths["/items"].parameters = [
    {
      name: "whole",
      in: "querystring",
      content: {
        "application/x-www-form-urlencoded": { schema: { type: "object" } },
      },
    },
  ];
  doc.paths["/items"].get.parameters = [
    { name: "single", in: "query", schema: { type: "string" } },
  ];
  cases.push([doc, /QUERYSTRING_CONFLICT/]);
  doc = base();
  doc.paths["/items/{id}"] = {};
  doc.paths["/items/{name}"] = {};
  cases.push([doc, /TEMPLATE_DUPLICATE/]);
  doc = base();
  doc.paths["/items/{id}"] = { get: { responses: {} } };
  cases.push([doc, /PATH_PARAMETER/]);
  for (const [value, pattern] of cases)
    await assert.rejects(prepareModernDocument(JSON.stringify(value)), pattern);
  assert.throws(
    () => modernMethods({ additionalOperations: { "BAD METHOD": {} } }),
    /ADDITIONAL_METHOD/,
  );
  assert.deepEqual(
    modernMethods({ additionalOperations: { post: {} } }).map((o) => o.method),
    ["post"],
  );
});

test("path reference sibling conflicts, ungranted/nonsemantic targets and aliases fail closed", async () => {
  let doc = base();
  doc.components = { pathItems: { shared: { get: { responses: {} } } } };
  doc.paths["/items"] = {
    $ref: "#/components/pathItems/shared",
    get: { responses: {} },
  };
  await assert.rejects(
    prepareModernDocument(JSON.stringify(doc)),
    /PATH_REFERENCE_CONFLICT/,
  );
  doc = base();
  doc.paths["/items"].get.parameters = [
    { $ref: "file:///private/not-provided.json" },
  ];
  await assert.rejects(
    prepareModernDocument(JSON.stringify(doc)),
    /NOT_GRANTED/,
  );
  doc = base();
  doc.paths["/items"].get.responses["200"].content[
    "application/json"
  ].examples = {
    opaque: { value: { in: "query", name: "value", schema: true } },
  };
  doc.paths["/items"].get.parameters = [
    {
      $ref: "#/paths/~1items/get/responses/200/content/application~1json/examples/opaque/value",
    },
  ];
  await assert.rejects(
    prepareModernDocument(JSON.stringify(doc)),
    /TARGET_TYPE/,
  );
});

test("modern tag parent cycles, license/example exclusivity and malformed OAS objects reject", async () => {
  const cases = [];
  let doc = base();
  doc.tags = [
    { name: "a", parent: "b" },
    { name: "b", parent: "a" },
  ];
  cases.push([doc, /TAG_PARENT/]);
  doc = base();
  doc.info.license = {
    name: "MIT",
    identifier: "MIT",
    url: "https://example.invalid/license",
  };
  cases.push([doc, /LICENSE_CONFLICT/]);
  doc = base();
  doc.paths["/items"].get.responses["200"].content[
    "application/json"
  ].examples = { invalid: { value: 1, dataValue: 1 } };
  cases.push([doc, /EXAMPLE_CONFLICT/]);
  doc = base();
  delete doc.info.title;
  cases.push([doc, /DOCUMENT_STRUCTURE/]);
  doc = base();
  doc.components = {
    parameters: {
      Bad: {
        name: "bad",
        in: "query",
        schema: true,
        content: { "application/json": { schema: true } },
      },
    },
  };
  cases.push([doc, /SCHEMA_CONTENT/]);
  for (const [value, pattern] of cases)
    await assert.rejects(prepareModernDocument(JSON.stringify(value)), pattern);
});

test("3.2 response descriptions are optional and cookie style is native, not a 3.0 restriction", async () => {
  const doc = base();
  doc.paths["/items"].get.responses = { 200: {} };
  doc.paths["/items"].get.parameters = [
    {
      in: "cookie",
      name: "session",
      style: "cookie",
      explode: true,
      schema: { type: "string" },
    },
  ];
  const r = await prepareModernDocument(JSON.stringify(doc));
  assert.equal(r.operations[0].allParameters[0].style, "cookie");
  doc.paths["/items"].get.parameters[0].explode = false;
  await assert.rejects(
    prepareModernDocument(JSON.stringify(doc)),
    /COOKIE_SERIALIZATION/,
  );
});

test("nested positional encodings and sequential item schemas remain native3.2", async () => {
  const doc = base();
  doc.paths["/items"].get.requestBody = {
    content: {
      "multipart/mixed": {
        schema: { type: "array", prefixItems: [{ type: "string" }] },
        prefixEncoding: [
          {
            contentType: "multipart/mixed",
            prefixEncoding: [{ contentType: "text/plain" }],
            itemEncoding: { contentType: "application/octet-stream" },
          },
        ],
        itemEncoding: { contentType: "text/plain" },
      },
    },
  };
  doc.paths["/items"].get.responses["200"].content = {
    "application/x-ndjson": { itemSchema: { type: ["integer", "null"] } },
  };
  const r = await prepareModernDocument(JSON.stringify(doc));
  assert.equal(
    r.operations[0].op.requestBody.content["multipart/mixed"].prefixEncoding[0]
      .itemEncoding.contentType,
    "application/octet-stream",
  );
  assert.deepEqual(
    r.operations[0].op.responses["200"].content["application/x-ndjson"]
      .itemSchema.type,
    ["integer", "null"],
  );
});

test("security requirements retain role arrays and explicit URI-keyed schemes without fetching", async () => {
  const doc = base();
  doc.components = { securitySchemes: { tls: { type: "mutualTLS" } } };
  doc.paths["/items"].get.security = [{ tls: ["operator"] }];
  let r = await prepareModernDocument(JSON.stringify(doc));
  assert.deepEqual(r.operations[0].op.security[0].tls, ["operator"]);
  doc.paths["/items"].get.security = [
    { "https://auth.invalid/defs#/components/securitySchemes/key": [] },
  ];
  const other = {
    openapi: "3.2.1",
    info: { title: "auth", version: "1" },
    components: {
      securitySchemes: { key: { type: "apiKey", in: "header", name: "X-Key" } },
    },
  };
  r = await prepareModernDocument(JSON.stringify(doc), {
    documents: { "https://auth.invalid/defs": JSON.stringify(other) },
  });
  assert.equal(
    r.operations[0].securitySchemes[
      "https://auth.invalid/defs#/components/securitySchemes/key"
    ].type,
    "apiKey",
  );
});

test("non-OAuth roles are a 3.2 feature, not a 3.1 security requirement", async () => {
  const doc = base();
  doc.components = {
    securitySchemes: {
      key: { type: "apiKey", in: "header", name: "X-Key" },
      oauth: {
        type: "oauth2",
        flows: {
          clientCredentials: {
            tokenUrl: "https://auth.invalid/token",
            scopes: { read: "Read" },
          },
        },
      },
    },
  };
  doc.paths["/items"].get.security = [{ key: ["operator"] }];
  assert.deepEqual(
    (await prepareModernDocument(JSON.stringify(doc))).operations[0].op
      .security[0].key,
    ["operator"],
  );
  doc.openapi = "3.1.2";
  await assert.rejects(
    prepareModernDocument(JSON.stringify(doc)),
    /MODERN_SECURITY_REQUIREMENT/,
  );
  doc.paths["/items"].get.security = [{ key: [] }, { oauth: ["read"] }];
  assert.equal(
    (await prepareModernDocument(JSON.stringify(doc))).operations.length,
    1,
  );
});

test("explicit serialized example grants stay opaque, while bare typed reference roots retain their schema", async () => {
  const doc = base();
  doc.paths["/items"].get.parameters = [
    { $ref: "https://parts.invalid/parameter.yaml" },
  ];
  doc.paths["/items"].get.responses["200"].content["application/xml"] = {
    schema: { type: "object" },
    examples: { serialized: { $ref: "https://parts.invalid/example.yaml" } },
  };
  const raw =
    "<sample><items>$ref: file:///private/never-read</items></sample>";
  const r = await prepareModernDocument(JSON.stringify(doc), {
    documents: {
      "https://parts.invalid/parameter.yaml": JSON.stringify({
        in: "query",
        name: "id",
        schema: { type: "integer" },
      }),
      "https://parts.invalid/example.yaml": JSON.stringify({
        externalValue: "https://examples.invalid/opaque.xml",
      }),
      "https://examples.invalid/opaque.xml": raw,
    },
  });
  assert.equal(r.operations[0].allParameters[0].schema.type, "integer");
  assert.equal(r.resources.get("https://examples.invalid/opaque.xml#"), raw);
  assert.equal(r.resourceText("https://examples.invalid/opaque.xml"), raw);
  assert.ok(!r.schemaDocuments["https://examples.invalid/opaque.xml"]);
  assert.equal(
    r.schemaRoots.filter(
      (s) => s.schema === r.operations[0].allParameters[0].schema,
    ).length,
    1,
  );
});

test("physical schema URIs encode literal percent keys once and keep callback default IDs distinct", async () => {
  const doc = base();
  doc.components = {
    schemas: {
      Names: {
        type: "object",
        properties: {
          "%": { const: 1 },
          "%20": { const: 2 },
          " ": { const: 3 },
        },
      },
    },
  };
  doc.paths["/items"].get.callbacks = Object.fromEntries(
    ["first", "second"].map((name) => [
      name,
      { "{$request.body#/callback}": { post: { responses: { 200: {} } } } },
    ]),
  );
  const r = await prepareModernDocument(JSON.stringify(doc));
  const entries = [...r.schemaRegistry].filter(([uri]) =>
    uri.includes("properties"),
  );
  assert.equal(entries.length, 3);
  assert.ok(entries.some(([uri]) => uri.endsWith("%2F%25")));
  assert.ok(entries.some(([uri]) => uri.endsWith("%2F%2520")));
  assert.ok(entries.some(([uri]) => uri.endsWith("%2F%20")));
  const a = r.callbackOperations.get(
    r.definition.paths["/items"].get.callbacks.first,
  )[0];
  const b = r.callbackOperations.get(
    r.definition.paths["/items"].get.callbacks.second,
  )[0];
  assert.notEqual(a.id, b.id);
});

test("identity collisions, reference cycles, malformed grants and metadata limits fail closed", async () => {
  const doc = base();
  await assert.rejects(
    prepareModernDocument(JSON.stringify(doc), {
      documents: Object.fromEntries(
        Array.from({ length: 17 }, (_, i) => [
          "https://grants.invalid/" + i,
          "true",
        ]),
      ),
    }),
    /BUDGET/,
  );
  const external = {
    openapi: "3.2.1",
    $self: "https://collision.invalid/canonical",
    info: { title: "parts", version: "1" },
    components: {},
  };
  await assert.rejects(
    prepareModernDocument(JSON.stringify(doc), {
      documents: {
        "https://one.invalid/a": JSON.stringify(external),
        "https://two.invalid/b": JSON.stringify(external),
      },
    }),
    /IDENTITY_COLLISION/,
  );
  doc.components = {
    parameters: {
      A: { $ref: "#/components/parameters/B" },
      B: { $ref: "#/components/parameters/A" },
    },
  };
  await assert.rejects(
    prepareModernDocument(JSON.stringify(doc)),
    /REFERENCE_CYCLE/,
  );
});

test("serialized example JSON that resembles an OpenAPI document is inert data", async () => {
  const doc = base();
  doc.paths["/items"].get.responses["200"].content = {
    "application/json": {
      schema: { type: "object" },
      examples: {
        documentPayload: {
          externalValue: "https://examples.invalid/looks-like-api.json",
        },
      },
    },
  };
  const raw = JSON.stringify({
    openapi: "3.2.1",
    info: { title: "data only", version: "1" },
    paths: { "/never-fetch": { $ref: "file:///private/not-granted" } },
  });
  const r = await prepareModernDocument(JSON.stringify(doc), {
    documents: { "https://examples.invalid/looks-like-api.json": raw },
  });
  assert.equal(
    r.resourceText("https://examples.invalid/looks-like-api.json"),
    raw,
  );
  assert.equal(r.externalContexts.length, 0);
  assert.equal(r.operations.length, 1);
});

test("component PathItem and Callback operations resolve by exact OAS ID/ref without implicit dispatch", async () => {
  const doc = base();
  doc.components = {
    pathItems: {
      Reusable: { get: { operationId: "component", responses: { 200: {} } } },
    },
    callbacks: {
      Notify: {
        "{$request.body#/callback}": {
          additionalOperations: {
            notify: {
              operationId: "componentCallback",
              responses: { 200: {} },
            },
          },
        },
      },
    },
  };
  doc.paths["/items"].get.responses["200"].links = {
    reusable: { operationId: "component" },
    callback: {
      operationRef:
        "#/components/callbacks/Notify/%7B%24request.body%23~1callback%7D/additionalOperations/notify",
    },
  };
  let prepared = await prepareModernDocument(JSON.stringify(doc));
  assert.equal(prepared.operations.length, 1);
  assert.equal(prepared.webhookOperations.length, 0);
  const component = prepared.resolveOperationId("component");
  assert.equal(component.zone, "components");
  assert.equal(component.route, undefined);
  assert.equal(component.bound, false);
  assert.equal(component.dispatchable, false);
  assert.equal(
    prepared.resolveOperationRef("#/components/pathItems/Reusable/get"),
    component,
  );
  const callback = prepared.resolveOperationId("componentCallback");
  assert.equal(callback.zone, "callbacks");
  assert.equal(callback.method, "notify");
  assert.equal(callback.dispatchable, false);
  assert.equal(
    prepared.callbackOperations.get(
      prepared.definition.components.callbacks.Notify,
    )[0],
    callback,
  );
  assert.ok(prepared.operationCatalog.includes(component));
  doc.paths["/bound"] = { $ref: "#/components/pathItems/Reusable" };
  prepared = await prepareModernDocument(JSON.stringify(doc));
  assert.equal(prepared.resolveOperationId("component").route, "/bound");
  assert.equal(
    prepared.resolveOperationRef("#/components/pathItems/Reusable/get").bound,
    true,
  );
});

test("inherited Security Requirement URIs use the declaring field's base/version, not imported Operation base", async () => {
  const doc = base();
  doc.security = [{ "./auth.json#/components/securitySchemes/key": [] }];
  doc.paths["/items"] = {
    $ref: "https://external.invalid/parts.json#/components/pathItems/X",
  };
  const external = {
    openapi: "3.2.1",
    info: { title: "parts", version: "1" },
    components: {
      pathItems: {
        X: { get: { operationId: "imported", responses: { 200: {} } } },
      },
    },
  };
  const auth = {
    openapi: "3.2.1",
    info: { title: "auth", version: "1" },
    components: {
      securitySchemes: { key: { type: "apiKey", in: "header", name: "X-Key" } },
    },
  };
  const prepared = await prepareModernDocument(JSON.stringify(doc), {
    documentURI: "https://entry.invalid/main.json",
    documents: {
      "https://external.invalid/parts.json": JSON.stringify(external),
      "https://entry.invalid/auth.json": JSON.stringify(auth),
    },
  });
  const imported = prepared.resolveOperationId("imported");
  assert.equal(imported.bound, true);
  assert.equal(imported.baseURI, "https://external.invalid/parts.json");
  assert.equal(
    imported.securitySchemes["./auth.json#/components/securitySchemes/key"]
      .name,
    "X-Key",
  );
});

test("synthetic tool IDs cannot satisfy Link.operationId, and explicit empty IDs remain resolvable", async () => {
  const doc = base();
  delete doc.paths["/items"].get.operationId;
  doc.paths["/items"].get.responses["200"].links = {
    wrong: { operationId: "GET /items" },
  };
  await assert.rejects(
    prepareModernDocument(JSON.stringify(doc)),
    /MODERN_LINK_OPERATION/,
  );
  doc.paths["/items"].get.operationId = "";
  doc.paths["/items"].get.responses["200"].links.wrong.operationId = "";
  let prepared = await prepareModernDocument(JSON.stringify(doc));
  assert.equal(prepared.resolveOperationId("").op.operationId, "");
  assert.equal(prepared.resolveOperationId("GET /items"), undefined);
  doc.paths["/real"] = {
    get: { operationId: "GET /items", responses: { 200: {} } },
  };
  prepared = await prepareModernDocument(JSON.stringify(doc));
  assert.equal(new Set(prepared.operations.map((op) => op.id)).size, 2);
  assert.equal(prepared.resolveOperationId("GET /items").route, "/real");
});

test("x-prefixed typed map keys and ServerVariable defaults are data, not extension field slots", async () => {
  const doc = base();
  doc.servers = [
    {
      url: "https://{x-shard}.invalid",
      variables: { "x-shard": { default: "one", enum: ["one", "two"] } },
    },
  ];
  doc.components = {
    headers: { "x-header": { schema: false } },
    examples: {
      "x-example": { dataValue: { literal: { $ref: "file:///never-read" } } },
    },
    securitySchemes: {
      "x-key": { type: "apiKey", in: "header", name: "X-Key" },
      oauth: {
        type: "oauth2",
        flows: {
          clientCredentials: {
            tokenUrl: "https://auth.invalid/token",
            scopes: { "x-scope": "Read" },
          },
        },
      },
    },
  };
  doc.security = [{ "x-key": [] }, { oauth: ["x-scope"] }];
  doc.paths["/items"].get.responses["200"].headers = {
    "x-optional": { schema: false },
    example: { schema: true },
    default: { schema: true },
    dataValue: { schema: true },
  };
  const content = doc.paths["/items"].get.responses["200"].content;
  content["x-vendor/json"] = {
    schema: true,
    examples: { "x-example": { $ref: "#/components/examples/x-example" } },
    encoding: { "x-field": { headers: { "x-ignored": { schema: false } } } },
  };
  doc.paths["/items"].additionalOperations = {
    "x-CUSTOM": { operationId: "custom", responses: { 200: {} } },
  };
  doc.paths["/items"].get.responses["200"].links = {
    next: {
      operationId: "custom",
      parameters: {
        "x-object": { $ref: "file:///literal-never-read" },
        default: { business: "data" },
      },
      requestBody: { $ref: "file:///literal-body" },
      server: {
        url: "https://{x-shard}.invalid",
        variables: { "x-shard": { default: "one" } },
      },
    },
  };
  const prepared = await prepareModernDocument(JSON.stringify(doc));
  assert.equal(prepared.operations.length, 2);
  assert.equal(prepared.operations[1].method, "x-CUSTOM");
  assert.equal(
    prepared.definition.servers[0].variables["x-shard"].default,
    "one",
  );
  assert.equal(
    prepared.definition.paths["/items"].get.responses["200"].headers[
      "x-optional"
    ].schema,
    false,
  );
  assert.equal(
    prepared.definition.paths["/items"].get.responses["200"].content[
      "x-vendor/json"
    ].encoding["x-field"].headers["x-ignored"].schema,
    false,
  );
  assert.equal(
    prepared.definition.paths["/items"].get.responses["200"].links.next
      .parameters["x-object"].$ref,
    "file:///literal-never-read",
  );
});

test("top-level security is validated even without operations or when all operations override it", async () => {
  const doc = base("3.1.2");
  doc.components = {
    securitySchemes: { Key: { type: "apiKey", in: "header", name: "X-Key" } },
  };
  doc.security = [{ Key: ["operator"] }];
  doc.paths = {};
  await assert.rejects(
    prepareModernDocument(JSON.stringify(doc)),
    /MODERN_SECURITY_REQUIREMENT/,
  );
  doc.openapi = "3.2.1";
  assert.equal(
    (await prepareModernDocument(JSON.stringify(doc))).operations.length,
    0,
  );
  doc.security = [{ absent: [] }];
  await assert.rejects(
    prepareModernDocument(JSON.stringify(doc)),
    /MODERN_REFERENCE_NOT_GRANTED/,
  );
  doc.paths["/override"] = { get: { security: [], responses: { 200: {} } } };
  await assert.rejects(
    prepareModernDocument(JSON.stringify(doc)),
    /MODERN_REFERENCE_NOT_GRANTED/,
  );
  doc.security = [{ Key: [] }, {}];
  assert.equal(
    (await prepareModernDocument(JSON.stringify(doc))).operations.length,
    1,
  );
});

test("data-only externalValue grants never acquire OpenAPI identities, regardless of apparent fields", async () => {
  const doc = base();
  doc.paths["/items"].get.responses["200"].content[
    "application/json"
  ].examples = {
    payload: { externalValue: "https://data.invalid/payload.json" },
  };
  for (const payload of [
    {
      openapi: "3.2.1",
      $self: "https://moonapi.invalid/openapi.json",
      customer: "data",
    },
    { openapi: "3.2.1", $self: "not a uri", customer: "data" },
    {
      openapi: "3.1.2",
      $self: "file:///data/not-an-OpenAPI-identity",
      customer: "data",
    },
  ]) {
    const raw = JSON.stringify(payload);
    const prepared = await prepareModernDocument(JSON.stringify(doc), {
      documents: { "https://data.invalid/payload.json": raw },
    });
    assert.equal(
      prepared.resourceText("https://data.invalid/payload.json"),
      raw,
    );
    assert.equal(prepared.externalContexts.length, 0);
    assert.equal(prepared.operations.length, 1);
    assert.equal(prepared.documentURI, "https://moonapi.invalid/openapi.json");
  }
  const external = {
    openapi: "3.2.1",
    $self: "https://parts.invalid/declared.json",
    info: { title: "parts", version: "1" },
    components: {
      examples: {
        payload: { externalValue: "https://data.invalid/payload.json" },
      },
    },
  };
  delete doc.paths["/items"].get.responses["200"].content["application/json"]
    .examples;
  const opaque = JSON.stringify({
    openapi: "3.2.1",
    $self: "not a uri",
    customer: "data",
  });
  // The potential payload appears before its declaring OAD in the grant map.
  let prepared = await prepareModernDocument(JSON.stringify(doc), {
    documents: {
      "https://data.invalid/payload.json": opaque,
      "https://parts.invalid/retrieved.json": JSON.stringify(external),
    },
  });
  assert.equal(prepared.externalContexts.length, 1);
  assert.equal(
    prepared.externalContexts[0].documentURI,
    "https://parts.invalid/declared.json",
  );
  assert.equal(
    prepared.resourceText("https://data.invalid/payload.json"),
    opaque,
  );
  // An explicit semantic $ref may intentionally interpret the same bytes as
  // an OAD, in addition to their serialized-example use.
  external.components.parameters = {
    P: { in: "query", name: "p", schema: true },
  };
  doc.paths["/items"].get.parameters = [
    { $ref: "https://parts.invalid/declared.json#/components/parameters/P" },
  ];
  prepared = await prepareModernDocument(JSON.stringify(doc), {
    documents: {
      "https://data.invalid/payload.json": opaque,
      "https://parts.invalid/retrieved.json": JSON.stringify(external),
    },
  });
  assert.equal(prepared.operations[0].allParameters[0].name, "p");
  doc.paths["/items"].get.responses["200"].content[
    "application/json"
  ].examples = {
    document: { externalValue: "https://parts.invalid/retrieved.json" },
  };
  prepared = await prepareModernDocument(JSON.stringify(doc), {
    documents: {
      "https://data.invalid/payload.json": opaque,
      "https://parts.invalid/retrieved.json": JSON.stringify(external),
    },
  });
  assert.equal(prepared.externalContexts.length, 1);
  assert.equal(prepared.operations[0].allParameters[0].name, "p");
});

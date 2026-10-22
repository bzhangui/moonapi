// Adapter contract for TWO test-only collections, not a complete PB OpenAPI spec.
export function pocketbaseSpec(collection, field) {
  if (
    !["moonapi_notes", "moonapi_tasks"].includes(collection) ||
    !["name", "title"].includes(field)
  )
    throw new Error("Test collections only");
  const route = `/api/collections/${collection}/records`;
  const json = (schema) => ({ "application/json": { schema } });
  const response = {
    description: "Record",
    content: json({ $ref: "#/components/schemas/Record" }),
  };
  const error = { description: "Missing", content: json({ type: "object" }) };
  return JSON.stringify({
    openapi: "3.0.3",
    info: { title: "Test-only PocketBase adapter contract", version: "0.40.5" },
    paths: {
      [route]: {
        post: {
          operationId: "create",
          requestBody: { $ref: "#/components/requestBodies/Write" },
          responses: { 200: { $ref: "#/components/responses/Record" } },
        },
      },
      [route + "/{id}"]: {
        parameters: [{ $ref: "#/components/parameters/ID" }],
        get: {
          operationId: "read",
          responses: {
            200: { $ref: "#/components/responses/Record" },
            404: error,
          },
        },
        patch: {
          operationId: "update",
          requestBody: { $ref: "#/components/requestBodies/Write" },
          responses: { 200: { $ref: "#/components/responses/Record" } },
        },
        delete: {
          operationId: "delete",
          responses: { 204: { description: "Deleted" } },
        },
      },
    },
    components: {
      parameters: {
        ID: {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", minLength: 15, maxLength: 15 },
        },
      },
      requestBodies: {
        Write: {
          required: true,
          content: json({
            type: "object",
            required: [field],
            properties: {
              [field]: { type: "string", minLength: 1, maxLength: 64 },
            },
          }),
        },
      },
      responses: { Record: response },
      schemas: {
        Record: {
          type: "object",
          required: ["id", field],
          properties: {
            id: { type: "string", minLength: 15, maxLength: 15 },
            [field]: { type: "string", minLength: 1, maxLength: 64 },
          },
        },
      },
    },
  });
}

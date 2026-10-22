///|
fn main {
  try {
    let body : Json = {
      "type": "object",
      "required": ["name"],
      "properties": { "name": { "type": "string", "maxLength": 64 } },
    }
    let record : Json = {
      "type": "object",
      "properties": {
        "id": { "type": "integer" },
        "name": { "type": "string" },
      },
    }
    let id : Json = {
      "name": "id",
      "in": "path",
      "required": true,
      "schema": { "type": "integer" },
    }
    let spec : @engine.Spec = {
      operations: [
        {
          id: "new",
          verb: "POST",
          path: "/notes",
          parameters: [],
          request: body,
          responses: { "201": record },
        },
        {
          id: "find",
          verb: "GET",
          path: "/notes/{id}",
          parameters: [id],
          request: null,
          responses: { "200": record, "404": null },
        },
        {
          id: "edit",
          verb: "PATCH",
          path: "/notes/{id}",
          parameters: [id],
          request: body,
          responses: { "200": record },
        },
        {
          id: "remove",
          verb: "DELETE",
          path: "/notes/{id}",
          parameters: [id],
          request: null,
          responses: { "204": null },
        },
      ],
    }
    let generated = @engine.crud_plan(
      spec, "/notes", "name", "moonapi_111111111111111111111111", "moonapi_222222222222222222222222",
    )
    @engine.validate_sequence(@engine.field(generated, "trace"))
    assert_eq(@engine.field(generated, "profile"), "owned-crud-v1")
    println("portable CRUD consumer verified")
  } catch {
    _ => abort("portable CRUD consumer failed")
  }
}

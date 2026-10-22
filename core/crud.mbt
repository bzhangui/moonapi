///|
fn crud_body(
  op : Operation,
  key : String,
  marker : String,
) -> Json raise TestError {
  let base = make_case(op, 42).body
  guard field(op.request, "type") == "object" &&
    field(field(op.request, "properties"), key) != null else {
    raise Invalid("CRUD probe field must exist in both request schemas")
  }
  let copy : Map[String, Json] = Map([])
  for name in fields(base) {
    copy[name] = field(base, name)
  }
  copy[key] = Json(marker)
  let body = Json(copy)
  guard validate_value(op.request, body).is_empty() else {
    raise Invalid("CRUD marker violates request schema")
  }
  body
}

///|
// A deliberately narrow, reviewable convention profile, not business semantics
// inferred from arbitrary names. Unsupported/ambiguous shapes fail before I/O.
pub fn crud_plan(
  spec : Spec,
  collection : String,
  probe_field : String,
  marker : String,
  changed : String,
) -> Json raise TestError {
  guard !collection.contains("{") && !collection.has_suffix("/") else {
    raise Invalid("CRUD collection must be a literal path")
  }
  guard probe_field != "id" &&
    probe_field.length() > 0 &&
    !probe_field.contains("/") &&
    !probe_field.contains("~") else {
    raise Invalid("simple non-ID CRUD field required")
  }
  guard marker != changed && marker.length() >= 24 && changed.length() >= 24 else {
    raise Invalid("distinct ownership markers required")
  }
  let creates = spec.operations.filter(op => {
    op.path == collection && op.verb == "POST"
  })
  let reads = spec.operations.filter(op => {
    op.path.has_prefix(collection + "/{") &&
    op.path.has_suffix("}") &&
    op.verb == "GET"
  })
  guard creates.length() == 1 && reads.length() == 1 else {
    raise Invalid("CRUD requires one unambiguous create/read pair")
  }
  let create = creates[0]
  let read = reads[0]
  let updates = spec.operations.filter(op => {
    op.path == read.path && (op.verb == "PUT" || op.verb == "PATCH")
  })
  let deletes = spec.operations.filter(op => {
    op.path == read.path && op.verb == "DELETE"
  })
  guard updates.length() == 1 && deletes.length() == 1 else {
    raise Invalid("CRUD requires one update and delete operation")
  }
  let update = updates[0]
  let delete = deletes[0]
  guard !fields(field(create.request, "properties")).contains("id") &&
    !fields(field(update.request, "properties")).contains("id") else {
    raise Invalid(
      "automatic CRUD requires server-generated IDs, not writable ID bodies",
    )
  }
  guard create.parameters.is_empty() &&
    read.parameters.length() == 1 &&
    update.parameters.length() == 1 &&
    delete.parameters.length() == 1 else {
    raise Invalid("CRUD profile requires a single resource path parameter")
  }
  let parameter = read.parameters[0]
  let parameter_name = text(field(parameter, "name"))
  guard field(parameter, "in") == "path" &&
    read.path == collection + "/{" + parameter_name + "}" else {
    raise Invalid("CRUD nested resources require explicit modeling")
  }
  let id_schema = field(parameter, "schema")
  guard ["integer", "string"].contains(text(field(id_schema, "type"))) else {
    raise Invalid("CRUD ID must be integer or string")
  }
  for op in [update, delete] {
    guard op.parameters[0] == parameter else {
      raise Invalid("CRUD ID schemas must agree")
    }
  }
  let create_status = if fields(create.responses).contains("201") {
    201
  } else if fields(create.responses).contains("200") {
    200
  } else {
    raise Invalid("CRUD create requires 200 or 201")
  }
  guard fields(read.responses).contains("200") &&
    fields(read.responses).contains("404") &&
    fields(update.responses).contains("200") else {
    raise Invalid(
      "CRUD profile needs explicit synchronous success and missing statuses",
    )
  }
  let delete_status = if fields(delete.responses).contains("204") {
    204
  } else if fields(delete.responses).contains("200") {
    200
  } else {
    raise Invalid("CRUD delete requires 200 or 204")
  }
  for
    schema in [
      field(create.responses, "\{create_status}"),
      field(read.responses, "200"),
      field(update.responses, "200"),
    ] {
    let props = field(schema, "properties")
    guard field(schema, "type") == "object" &&
      field(field(props, "id"), "type") == field(id_schema, "type") &&
      field(field(props, probe_field), "type") == "string" &&
      validate_value(field(props, probe_field), Json(marker)).is_empty() &&
      validate_value(field(props, probe_field), Json(changed)).is_empty() else {
      raise Invalid("CRUD responses require matching id and probe field")
    }
  }
  let parameters : Map[String, Json] = Map([])
  parameters[parameter_name] = { "$from": "owned_id" }
  let bound = Json(parameters)
  let trace : Json = {
    "format": 1,
    "name": "owned_resource_crud",
    "initial": { "phase": "empty" },
    "steps": [
      {
        "id": "create",
        "operationId": Json(create.id),
        "requires": { "phase": "empty" },
        "set": { "phase": "created" },
        "body": crud_body(create, probe_field, marker),
        "status": Json(create_status),
        "capture": { "owned_id": "/id" },
      },
      {
        "id": "read_initial",
        "operationId": Json(read.id),
        "requires": { "phase": "created" },
        "parameters": bound,
        "status": 200,
        "assert": [
          {
            "id": "created_value",
            "pointer": Json("/" + probe_field),
            "op": "eq",
            "expected": Json(marker),
          },
        ],
      },
      {
        "id": "update",
        "operationId": Json(update.id),
        "requires": { "phase": "created" },
        "set": { "phase": "updated" },
        "parameters": bound,
        "body": crud_body(update, probe_field, changed),
        "status": 200,
      },
      {
        "id": "readback",
        "operationId": Json(read.id),
        "requires": { "phase": "updated" },
        "parameters": bound,
        "status": 200,
        "assert": [
          {
            "id": "persisted_value",
            "pointer": Json("/" + probe_field),
            "op": "eq",
            "expected": Json(changed),
          },
        ],
      },
      {
        "id": "delete",
        "operationId": Json(delete.id),
        "requires": { "phase": "updated" },
        "set": { "phase": "deleted" },
        "parameters": bound,
        "status": Json(delete_status),
      },
      {
        "id": "read_deleted",
        "operationId": Json(read.id),
        "requires": { "phase": "deleted" },
        "parameters": bound,
        "status": 404,
      },
    ],
  }
  validate_sequence(trace)
  {
    "trace": trace,
    "create": Json(create.id),
    "read": Json(read.id),
    "update": Json(update.id),
    "delete": Json(delete.id),
    "parameter": Json(parameter_name),
    "field": Json(probe_field),
    "delete_status": Json(delete_status),
    "create_status": Json(create_status),
    "id_schema": id_schema,
    "profile": "owned-crud-v1",
    "full_openapi_support": false,
  }
}

///|
pub fn parse_openapi(source : String) -> Spec raise {
  let root = bounded_json(source)
  guard text(field(root, "openapi")).has_prefix("3.0.") else {
    raise Invalid("OpenAPI 3.0 JSON required")
  }
  let paths = field(root, "paths")
  check_object(paths, "paths required")
  guard fields(paths).length() > 0 && fields(paths).length() <= 128 else {
    raise Invalid("path budget exceeded")
  }
  let operations = []
  let budget = [0]
  let seen : Map[String, Bool] = Map([])
  for path in fields(paths) {
    safe_name(path)
    guard path.has_prefix("/") &&
      !path.has_prefix("//") &&
      !path.contains("\\") &&
      !path.contains("?") &&
      !path.contains("#") else {
      raise Invalid("unsafe OpenAPI path")
    }
    let item = field(paths, path)
    check_object(item, "path item must be object")
    for key in fields(item) {
      guard [
          "get", "post", "put", "patch", "delete", "head", "options", "parameters",
          "summary", "description", "servers",
        ].contains(key) ||
        key.has_prefix("x-") else {
        raise Invalid("unsupported path item or HTTP method")
      }
    }
    for verb in ["get", "post", "put", "patch", "delete", "head", "options"] {
      let declaration = field(item, verb)
      if declaration == null {
        continue
      }
      let id = text(field(declaration, "operationId"))
      safe_name(id)
      guard !seen.contains(id) else { raise Invalid("duplicate operationId") }
      seen[id] = true
      let merged : Map[String, Json] = Map([])
      for list in [field(item, "parameters"), field(declaration, "parameters")] {
        if list != null {
          guard list is Array(_) else {
            raise Invalid("parameters must be array")
          }
        }
        for parameter in array(list) {
          let name = text(field(parameter, "name"))
          let location = text(field(parameter, "in"))
          safe_name(name)
          guard location == "query" || location == "path" else {
            raise Invalid("only query/path parameters supported")
          }
          guard field(parameter, "style") == null ||
            field(parameter, "style") == "simple" ||
            field(parameter, "style") == "form" else {
            raise Invalid("unsupported parameter style")
          }
          let schema = resolve_schema(
            root,
            field(parameter, "schema"),
            0,
            budget~,
          )
          guard !(field(schema, "nullable") is True) else {
            raise Invalid("nullable scalar parameters unsupported")
          }
          guard ["string", "integer", "number", "boolean"].contains(
            text(field(schema, "type")),
          ) else {
            raise Invalid("parameters must be scalar")
          }
          if location == "path" {
            guard field(parameter, "required") is True &&
              path.contains("{" + name + "}") else {
              raise Invalid(
                "path parameter must be required and appear in template",
              )
            }
          }
          merged[location + ":" + name] = {
            "name": Json(name),
            "in": Json(location),
            "required": field(parameter, "required"),
            "schema": schema,
          }
        }
      }
      guard merged.length() <= 32 else {
        raise Invalid("parameter budget exceeded")
      }
      let parameters = []
      for key in fields(Json(merged)) {
        parameters.push(merged[key])
      }
      let mut request = null
      if field(declaration, "requestBody") != null {
        let content = field(field(declaration, "requestBody"), "content")
        guard fields(content) == ["application/json"] else {
          raise Invalid("only JSON request bodies supported")
        }
        request = resolve_schema(
          root,
          field(field(content, "application/json"), "schema"),
          0,
          budget~,
        )
      }
      let responses : Map[String, Json] = Map([])
      let declarations = field(declaration, "responses")
      check_object(declarations, "responses required")
      guard fields(declarations).length() > 0 &&
        fields(declarations).length() <= 16 else {
        raise Invalid("response budget exceeded")
      }
      for status in fields(declarations) {
        let mut digits = status.length() == 3
        for c in status {
          if c < '0' || c > '9' {
            digits = false
          }
        }
        guard status == "default" ||
          (digits && status >= "100" && status <= "599") else {
          raise Invalid("unsupported response status")
        }
        let content = field(field(declarations, status), "content")
        if content == null {
          responses[status] = null
        } else {
          guard fields(content) == ["application/json"] else {
            raise Invalid("only JSON responses supported")
          }
          responses[status] = resolve_schema(
            root,
            field(field(content, "application/json"), "schema"),
            0,
            budget~,
          )
        }
      }
      operations.push({
        id,
        verb: verb.to_upper(),
        path,
        parameters,
        request,
        responses: Json(responses),
      })
      guard operations.length() <= 256 else {
        raise Invalid("operation budget exceeded")
      }
    }
  }
  guard operations.length() > 0 else {
    raise Invalid("no supported operations")
  }
  { operations, }
}

///|
pub fn operation(spec : Spec, id : String) -> Operation raise TestError {
  for op in spec.operations {
    if op.id == id {
      return op
    }
  }
  raise Invalid("unknown operationId")
}

// Test-only fresh database. NEVER apply to a real PocketBase instance.
// Original fixture using the public PocketBase migration API, not backend code.
migrate((app) => {
  for (const [name, field] of [
    ["moonapi_notes", "title"],
    ["moonapi_tasks", "name"],
  ]) {
    app.save(
      new Collection({
        type: "base",
        name,
        listRule: "",
        viewRule: "",
        createRule: "",
        updateRule: "",
        deleteRule: "",
        fields: [
          { type: "text", name: field, required: true, min: 1, max: 64 },
        ],
      }),
    );
  }
});

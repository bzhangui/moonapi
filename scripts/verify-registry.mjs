import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { moon, moonEnv } from "./build.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const version =
  process.argv[2] ||
  JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
if (!/^\d+\.\d+\.\d+$/.test(version))
  throw new Error("Explicit release version required");
const parent = path.join(root, ".local/registry-consumers");
fs.mkdirSync(parent, { recursive: true });
const consumer = path.join(parent, randomUUID());
fs.mkdirSync(consumer);
fs.writeFileSync(
  path.join(consumer, "moon.mod"),
  'name = "verification/moonapi"\nversion = "0.0.0"\n',
  { flag: "wx" },
);
fs.copyFileSync(
  path.join(root, "examples/core/moon.pkg"),
  path.join(consumer, "moon.pkg"),
  fs.constants.COPYFILE_EXCL,
);
fs.copyFileSync(
  path.join(root, "examples/core/main.mbt"),
  path.join(consumer, "main.mbt"),
  fs.constants.COPYFILE_EXCL,
);
const regression =
  '///|\npub fn verify_patch() -> Unit raise {\n  let schema : Json = { "type": "integer", "maximum": -1 }\n  let value = @engine.generate_value(schema, 0)\n  assert_true(@engine.validate_value(schema, value).is_empty())\n  let issues = @engine.validate_value({ "type": "object", "additionalProperties": false }, { "controlled-secret-property": 1 })\n  assert_true(issues[0].pointer == "$/<undeclared>")\n  assert_true(try { ignore(@engine.json_pointer([1, 2], "/01")); false } catch { _ => true })\n}\n///|\ntest "independent registered patch behavior" { verify_patch() }\n';
const regressionFolder = path.join(consumer, "patch");
fs.mkdirSync(regressionFolder);
fs.writeFileSync(
  path.join(regressionFolder, "moon.pkg"),
  'import { "bzhangui/moonapi/core" @engine }\n',
  { flag: "wx" },
);
fs.writeFileSync(path.join(regressionFolder, "regression.mbt"), regression, {
  flag: "wx",
});
const parts = version.split(".").map(Number);
const atLeast = (minor) => parts[0] > 0 || parts[1] >= minor;
const examples = ["."];
for (const [enabled, example] of [
  [atLeast(2), "behavior_core"],
  [atLeast(3), "crud_core"],
]) {
  if (!enabled) continue;
  const destination = path.join(consumer, example);
  fs.mkdirSync(destination);
  for (const filename of ["moon.pkg", "main.mbt"])
    fs.copyFileSync(
      path.join(root, "examples", example, filename),
      path.join(destination, filename),
      fs.constants.COPYFILE_EXCL,
    );
  examples.push(example);
}
if (atLeast(3)) {
  // Consume only public API from the downloaded dependency, never internal sources.
  const compatibility = `///|
test "registered shared read and write schema preserves directional constraints" {
  let schema : Json = {"type":"object","required":["id","secret","name"],"additionalProperties":false,"properties":{"id":{"type":"integer","readOnly":true},"secret":{"type":"string","writeOnly":true},"name":{"type":"string"}}}
  let spec_json : Json = {"openapi":"3.0.3","paths":{"/shared":{"post":{"requestBody":{"content":{"application/json":{"schema":schema}}},"responses":{"200":{"content":{"application/json":{"schema":schema}}}}}}}}
  let spec = @engine.parse_openapi(spec_json.stringify())
  let op = spec.operations[0]
  assert_eq(op.id,"POST /shared")
  let cases = @engine.plan(spec,limit=1)
  let body = cases[0].body
  assert_true(@engine.field(body,"id") == null)
  assert_true(@engine.field(body,"secret") != null)
  assert_true(@engine.validate_response(op,cases[0],200,{"id":1,"name":"yes"}).passed)
  assert_true(!@engine.validate_response(op,cases[0],200,{"name":"yes"}).passed)
}
`;
  fs.writeFileSync(
    path.join(regressionFolder, "compatibility.mbt"),
    compatibility,
    { flag: "wx" },
  );
}
function run(args) {
  const result = spawnSync(moon, args, {
    cwd: consumer,
    env: moonEnv,
    stdio: "inherit",
  });
  if (result.error || result.status !== 0)
    throw new Error("Independent registry consumer failed: " + args.join(" "));
}
run(["add", "bzhangui/moonapi@" + version]);
for (const target of ["js", "wasm", "wasm-gc", "native"]) {
  run(["check", "--target", target, "--deny-warn"]);
  run(["build", "--target", target, "--release", "--deny-warn"]);
  for (const example of examples) run(["run", example, "--target", target]);
  run(["test", "--target", target, "--deny-warn"]);
}
fs.writeFileSync(
  path.join(consumer, "verification.json"),
  JSON.stringify(
    {
      module: "bzhangui/moonapi",
      version,
      registry_dependency: true,
      local_source_copy: false,
      targets: ["js", "wasm", "wasm-gc", "native"],
      executable_consumers: examples,
      stateful_api_verified: atLeast(2),
      crud_api_verified: atLeast(3),
      directional_schema_verified: atLeast(3),
      ok: true,
    },
    null,
    2,
  ),
  { flag: "wx" },
);
console.log(
  JSON.stringify({ ok: true, module: "bzhangui/moonapi@" + version, consumer }),
);

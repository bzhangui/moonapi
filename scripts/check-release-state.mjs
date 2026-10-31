import fs from "node:fs";
import assert from "node:assert/strict";
const read = (name) =>
  fs.readFileSync(new URL("../" + name, import.meta.url), "utf8");
const state = JSON.parse(read("release-state.json")),
  pkg = JSON.parse(read("package.json")),
  lock = JSON.parse(read("package-lock.json"));
assert.equal(state.format, 1);
assert.equal(pkg.version, state.source);
assert.equal(lock.version, state.source);
assert.equal(lock.packages[""].version, state.source);
assert.match(
  read("moon.mod"),
  new RegExp('version = "' + state.source.replaceAll(".", "\\.") + '"'),
);
assert.ok(read("README.md").includes("当前源码：" + state.source));
assert.ok(
  read("README.md").includes("Mooncakes 核心库：" + state.published_core),
);
assert.ok(!read("README.md").includes("当前源码候选为 **0.8.0-rc.1**"));
assert.ok(!read("workbench/index.html").includes("执行仍保持禁用"));
console.log(JSON.stringify({ release_state_consistent: true, ...state }));

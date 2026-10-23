import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("project and bundled core license attributions identify the correct owners", () => {
  const license = fs.readFileSync(
    new URL("../LICENSE", import.meta.url),
    "utf8",
  );
  const notice = fs.readFileSync(new URL("../NOTICE", import.meta.url), "utf8");
  const core = fs.readFileSync(
    new URL("../licenses/MoonBit-Apache-2.0.txt", import.meta.url),
    "utf8",
  );
  assert.match(license, /Copyright 2026 MoonAPI contributors/);
  assert.ok(!license.includes("MoonRestore"));
  assert.match(notice, /^MoonAPI\r?\n/);
  const original = core.match(
    /Copyright \d{4} International Digital Economy Academy/,
  );
  assert.ok(original);
  assert.ok(notice.includes(original[0]));
  assert.match(core, /Version 2\.0, January 2004/);
});

test("standards adapter dependency graph is locked, licensed and privacy boundaries remain", () => {
  const root = new URL("../", import.meta.url);
  const pkg = JSON.parse(
    fs.readFileSync(new URL("package.json", root), "utf8"),
  );
  const lock = JSON.parse(
    fs.readFileSync(new URL("package-lock.json", root), "utf8"),
  );
  assert.equal(lock.packages[""].version, pkg.version);
  const text = fs.readFileSync(new URL("docs/THIRD_PARTY.md", root), "utf8");
  for (const [name, version] of Object.entries(pkg.dependencies)) {
    assert.match(version, /^\d+\.\d+\.\d+$/);
    assert.equal(lock.packages["node_modules/" + name].version, version);
    assert.ok(text.includes(name) && text.includes(version));
  }
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (!name) continue;
    assert.ok(entry.integrity && entry.license);
    assert.ok(!name.includes(".."));
  }
  const ignored = fs.readFileSync(new URL(".gitignore", root), "utf8");
  assert.ok(ignored.includes("*申报书*.md") && ignored.includes(".local/"));
});

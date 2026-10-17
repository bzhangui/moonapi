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

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveNpmCLI } from "../scripts/npm-cli.mjs";
test("npm CLI resolution supports both official Unix and Windows layouts without a shell", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "moonapi-npm-layout-"));
  try {
    const unix = path.join(root, "unix"),
      win = path.join(root, "win");
    for (const file of [
      path.join(unix, "lib/node_modules/npm/bin/npm-cli.js"),
      path.join(win, "node_modules/npm/bin/npm-cli.js"),
    ]) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "// controlled layout fixture");
    }
    assert.equal(
      resolveNpmCLI({ execPath: path.join(unix, "bin/node"), env: {} }),
      fs.realpathSync(path.join(unix, "lib/node_modules/npm/bin/npm-cli.js")),
    );
    assert.equal(
      resolveNpmCLI({ execPath: path.join(win, "node.exe"), env: {} }),
      fs.realpathSync(path.join(win, "node_modules/npm/bin/npm-cli.js")),
    );
    assert.throws(
      () =>
        resolveNpmCLI({
          execPath: path.join(root, "missing/node"),
          env: { MOONAPI_NPM_CLI: path.join(root, "absent") },
        }),
      /NOT_FOUND/,
    );
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});

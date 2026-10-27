import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { startWorkbench } from "../platform/workbench-server.mjs";
import {
  workflowFixture,
  workflowSource,
} from "../examples/workflow-fixture.mjs";
const sleep = (n) => new Promise((r) => setTimeout(r, n));
test("local workbench blocks unauthenticated/CSRF/write escalation, executes owned fixture and redacts results", async () => {
  const f = await workflowFixture(),
    s = await startWorkbench({ port: 0, allowWrite: true });
  const post = (route, body, extra = {}) =>
    fetch(s.origin + "/api/" + route, {
      method: "POST",
      headers: {
        authorization: "Bearer " + s.token,
        "content-type": "application/json",
        ...extra,
      },
      body: JSON.stringify(body),
    });
  try {
    const page = await fetch(s.origin);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /仅本机/);
    assert.match(
      page.headers.get("content-security-policy"),
      /frame-ancestors 'none'/,
    );
    assert.equal((await fetch(s.origin + "/api/session")).status, 401);
    assert.equal(
      (
        await post(
          "inspect",
          { source: workflowSource() },
          { origin: "https://evil.invalid" },
        )
      ).status,
      403,
    );
    const inspect = await post("inspect", { source: workflowSource() });
    assert.equal(inspect.status, 200);
    assert.ok((await inspect.json()).operations.length > 0);
    const parallel = await Promise.all([
      post("inspect", { source: workflowSource() }),
      post("inspect", { source: workflowSource() }),
    ]);
    assert.deepEqual(parallel.map((r) => r.status).sort(), [200, 409]);
    assert.equal(
      (
        await post("run", {
          source: workflowSource(),
          base: "https://example.invalid",
          mode: "contract",
        })
      ).status,
      400,
    );
    assert.equal(f.requests, 0);
    const run = await post("run", {
      source: workflowSource(),
      base: f.base,
      mode: "owned",
      resource: {
        create: "create",
        read: "read",
        update: "update",
        remove: "delete",
      },
      allowWrite: true,
      allowCleanup: true,
    });
    assert.equal(run.status, 202);
    let r;
    for (let i = 0; i < 120; i++) {
      r = await (
        await fetch(s.origin + "/api/status", {
          headers: { authorization: "Bearer " + s.token },
        })
      ).json();
      if (r.state !== "running") break;
      await sleep(50);
    }
    assert.equal(r.state, "finished");
    assert.equal(r.report.passed, true);
    assert.equal(r.report.cleanup_verified, true);
    assert.equal(f.remaining, 0);
    assert.ok(!JSON.stringify(r).includes("moonapi_"));
    assert.equal(
      (await post("profile-save", { profile: { source: "private" } })).status,
      409,
    );
    assert.equal((await fetch(s.origin + "/?token=leak")).status, 400);
  } finally {
    await s.close();
    await f.close();
  }
});
test("startup read-only capability cannot be upgraded by a browser request; private snapshots are encrypted", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "moonapi-workbench-")),
    s = await startWorkbench({
      port: 0,
      profileDirectory: dir,
      profileKey: randomBytes(32),
    });
  const post = (route, body) =>
    fetch(s.origin + "/api/" + route, {
      method: "POST",
      headers: {
        authorization: "Bearer " + s.token,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  try {
    assert.equal((await post("run", { allowWrite: true })).status, 403);
    const saved = await (
      await post("profile-save", { profile: { source: "private-source" } })
    ).json();
    assert.ok(saved.id);
    assert.ok(
      !fs
        .readFileSync(path.join(dir, saved.id + ".json"), "utf8")
        .includes("private-source"),
    );
    const loaded = await (await post("profile-load", { id: saved.id })).json();
    assert.equal(loaded.profile.source, "private-source");
    assert.equal(
      (await post("profile-load", { id: "../../keys" })).status,
      400,
    );
  } finally {
    await s.close();
    fs.rmSync(dir, { recursive: true });
  }
});
test("project init is offline/private/no-overwrite and run requires explicit base", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "moonapi-project-")),
    spec = path.join(dir, "spec.json"),
    out = path.join(dir, "config.json");
  try {
    fs.writeFileSync(spec, workflowSource());
    const r = spawnSync(
      process.execPath,
      ["bin/moonapi-project.mjs", "init", spec, "--out", out],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 0, r.stderr);
    const c = JSON.parse(fs.readFileSync(out));
    assert.equal(c.mode, "contract");
    assert.ok(c.operationIds.includes("health"));
    assert.ok(
      !c.operationIds.includes("read") && !c.operationIds.includes("poll"),
    );
    assert.ok(!c.allowWrite);
    assert.equal(
      spawnSync(process.execPath, [
        "bin/moonapi-project.mjs",
        "init",
        spec,
        "--out",
        out,
      ]).status,
      2,
    );
    assert.equal(
      spawnSync(process.execPath, ["bin/moonapi-project.mjs", "run", out])
        .status,
      2,
    );
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

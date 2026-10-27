#!/usr/bin/env node
import { startWorkbench } from "../platform/workbench-server.mjs";
import { environmentCredentials } from "../platform/adapters.mjs";
import { readPrivate } from "../platform/private-store.mjs";
import {
  workflowFixture,
  workflowSource,
} from "../examples/workflow-fixture.mjs";
let server, fixture;
try {
  const args = process.argv.slice(2),
    flags = new Set(),
    values = new Map();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (flags.has(a) || values.has(a)) throw new Error();
    if (["--demo", "--allow-write"].includes(a)) flags.add(a);
    else if (
      ["--port", "--origin", "--profiles", "--key-env", "--roles"].includes(
        a,
      ) &&
      args[i + 1]
    )
      values.set(a, args[++i]);
    else throw new Error();
  }
  if (flags.has("--demo")) fixture = await workflowFixture();
  const keyEnv = values.get("--key-env");
  if (keyEnv && !/^[A-Z_][A-Z0-9_]{0,127}$/.test(keyEnv)) throw new Error();
  const key = keyEnv ? process.env[keyEnv] : undefined;
  if (key !== undefined && !/^[a-f0-9]{64}$/i.test(key)) throw new Error();
  server = await startWorkbench({
    port: values.has("--port") ? Number(values.get("--port")) : 8791,
    allowWrite: flags.has("--allow-write"),
    allowRemote: values.has("--origin"),
    allowedOrigins: values.has("--origin") ? [values.get("--origin")] : [],
    profileDirectory: values.get("--profiles"),
    profileKey: key ? Buffer.from(key, "hex") : undefined,
    credentialProvider: values.has("--roles")
      ? environmentCredentials(
          JSON.parse(readPrivate(values.get("--roles"), 65536)),
        )
      : undefined,
    demo: fixture
      ? { source: workflowSource(), base: fixture.base }
      : undefined,
  });
  console.log(
    "MoonAPI local-only workbench. Session URL (do not share): " + server.url,
  );
  console.log(
    "No cloud publication. Unknown writes are never automatically retried.",
  );
  const close = async () => {
    await server.close();
    await fixture?.close();
    process.exit(0);
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
} catch {
  await server?.close();
  await fixture?.close();
  console.error("WORKBENCH_START_FAILED_CONTENTS_HIDDEN");
  process.exitCode = 2;
}

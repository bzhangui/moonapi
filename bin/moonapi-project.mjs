#!/usr/bin/env node
import path from "node:path";
import { readTextInput } from "../platform/input.mjs";
import { parseExact, stringifyExact } from "../platform/standard-value.mjs";
import {
  atomicPrivate,
  privateDirectory,
  readPrivate,
} from "../platform/private-store.mjs";
import { inspectProject, runProject } from "../platform/project-config.mjs";
import { environmentCredentials } from "../platform/adapters.mjs";
import { recoverLedger } from "../platform/execution-ledger.mjs";
import { publicReport } from "../platform/ci-tools.mjs";
try {
  const [action, file, ...args] = process.argv.slice(2);
  if (action === "recover" && file && !args.length) {
    console.log(JSON.stringify(await recoverLedger(file), null, 2));
  } else if (
    action === "init" &&
    file &&
    args.length === 2 &&
    args[0] === "--out"
  ) {
    const output = path.resolve(args[1]),
      source = readTextInput(file, 1048576),
      info = await inspectProject(source);
    privateDirectory(path.dirname(output), { create: true });
    atomicPrivate(output, {
      format: 1,
      spec: path.relative(path.dirname(output), path.resolve(file)),
      mode: "contract",
      operationIds: info.readonly_default,
      roles: {},
    });
    console.log(
      JSON.stringify({
        created: true,
        readonly_operations: info.readonly_default.length,
        configuration_is_private: true,
      }),
    );
  } else if (action === "run" && file) {
    const flags = new Set(),
      values = new Map();
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (flags.has(a) || values.has(a)) throw new Error();
      if (["--allow-write", "--allow-remote", "--allow-cleanup"].includes(a))
        flags.add(a);
      else if (
        ["--base", "--journal"].includes(a) &&
        args[i + 1] &&
        !args[i + 1].startsWith("--")
      )
        values.set(a, args[++i]);
      else throw new Error();
    }
    if (!values.has("--base")) throw new Error();
    const config = parseExact(readPrivate(file, 262144));
    if (
      config.format !== 1 ||
      Object.keys(config).some(
        (k) =>
          ![
            "format",
            "spec",
            "mode",
            "operationIds",
            "roles",
            "model",
            "resource",
            "seed",
            "limit",
            "timeout",
            "totalTimeout",
          ].includes(k),
      ) ||
      typeof config.spec !== "string"
    )
      throw new Error();
    const source = readTextInput(
      path.resolve(path.dirname(file), config.spec),
      1048576,
    );
    const report = await runProject(
      { ...config, source, base: values.get("--base") },
      {
        allowWrite: flags.has("--allow-write"),
        allowRemote: flags.has("--allow-remote"),
        allowCleanup: flags.has("--allow-cleanup"),
        credentialProvider: Object.keys(config.roles ?? {}).length
          ? environmentCredentials(config.roles)
          : undefined,
        journalDirectory: values.get("--journal"),
      },
    );
    console.log(stringifyExact(publicReport(report)));
    if (!report.passed) process.exitCode = 1;
  } else throw new Error();
} catch {
  console.error("PROJECT_INPUT_OR_EXECUTION_CONTENTS_HIDDEN");
  process.exitCode = 2;
}

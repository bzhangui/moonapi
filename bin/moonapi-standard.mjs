#!/usr/bin/env node
import { readTextInput, readJsonInput } from "../platform/input.mjs";
import { StandardEngine } from "../platform/standard.mjs";

let engine;
try {
  const [action, file, ...args] = process.argv.slice(2);
  if (!["check", "plan", "run"].includes(action) || !file)
    throw new Error("STANDARD_USAGE");
  const options = {},
    values = new Map();
  const booleans = {
    "--allow-write": "allowWrite",
    "--allow-remote": "allowRemote",
  };
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (values.has(key)) throw new Error("STANDARD_DUPLICATE_OPTION");
    if (booleans[key]) {
      options[booleans[key]] = true;
      values.set(key, true);
    } else if (["--base", "--seed", "--limit", "--references"].includes(key)) {
      const value = args[++i];
      if (!value || value.startsWith("--"))
        throw new Error("STANDARD_OPTION_VALUE");
      values.set(key, value);
    } else throw new Error("STANDARD_UNKNOWN_OPTION");
  }
  for (const key of ["seed", "limit"]) {
    const value = values.get("--" + key);
    if (value !== undefined) {
      if (!/^\d+$/.test(value)) throw new Error("STANDARD_NUMERIC_OPTION");
      options[key] = Number(value);
    }
  }
  if (values.has("--references"))
    options.documents = readJsonInput(values.get("--references"), 1048576);
  if (process.env.MOONAPI_STANDARD_CREDENTIALS) {
    if (Buffer.byteLength(process.env.MOONAPI_STANDARD_CREDENTIALS) > 16384)
      throw new Error("STANDARD_CREDENTIAL_BUDGET");
    try {
      options.credentials = JSON.parse(
        process.env.MOONAPI_STANDARD_CREDENTIALS,
      );
    } catch {
      throw new Error("STANDARD_CREDENTIAL_JSON");
    }
  }
  engine = await StandardEngine.open(readTextInput(file, 1048576), options);
  if (action === "check")
    console.log(
      JSON.stringify(
        {
          document_valid: true,
          operations: engine.description.operations.length,
          full_openapi_support: false,
          note: "Document validity is not execution or full compatibility proof.",
        },
        null,
        2,
      ),
    );
  if (action === "plan") {
    const plan = await engine.plan();
    // Generated bodies, examples, servers and credential values stay private.
    console.log(
      JSON.stringify(
        {
          operations: engine.description.operations.length,
          cases: plan.cases.length,
          available: plan.available,
          negative: plan.cases.filter((c) => c.negative).length,
          blockers: plan.blockers.map((b) => ({ code: b.code })),
          truncated: plan.truncated,
          full_openapi_support: false,
        },
        null,
        2,
      ),
    );
    if (plan.blockers.length || plan.truncated) process.exitCode = 1;
  }
  if (action === "run") {
    if (!values.has("--base"))
      throw new Error("STANDARD_EXPLICIT_BASE_REQUIRED");
    const result = await engine.run(values.get("--base"));
    // operationId can itself contain sensitive business metadata; CLI output
    // uses ordinal cases. In-process callers own the richer private result.
    const publicResult = {
      ...result,
      blockers: result.blockers.map((b) => ({ code: b.code })),
      records: result.records.map(({ operation_id, ...record }) => record),
    };
    console.log(JSON.stringify(publicResult, null, 2));
    if (!result.passed) process.exitCode = 1;
  }
} catch (error) {
  console.error(
    JSON.stringify({
      error: /^STANDARD_[A-Z_]+$/.test(error.message)
        ? error.message
        : "STANDARD_INPUT_OR_EXECUTION_ERROR",
      contents_hidden: true,
    }),
  );
  process.exitCode = 2;
} finally {
  await engine?.close();
}

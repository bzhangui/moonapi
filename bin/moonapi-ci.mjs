#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readTextInput } from "../platform/input.mjs";
import { parseExact, stringifyExact } from "../platform/standard-value.mjs";
import { StandardEngine } from "../platform/standard.mjs";
import { StandardWorkflow } from "../platform/workflow.mjs";
import { discoverDependencies } from "../platform/workflow-templates.mjs";
import {
  contractDiff,
  documentDigest,
  historyFor,
  historyPriority,
  writePrivate,
  renderReports,
  publicReport,
  loadReplay,
} from "../platform/ci-tools.mjs";
let engine;
try {
  const [action, spec, ...args] = process.argv.slice(2),
    values = new Map();
  if (
    !["discover", "run", "workflow", "replay", "diff"].includes(action) ||
    !spec
  )
    throw new Error("CI_USAGE");
  const flags = [
    "--allow-write",
    "--allow-remote",
    "--allow-callbacks",
    "--follow-links",
    "--allow-reset",
    "--shrink",
  ];
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (values.has(key)) throw new Error("CI_DUPLICATE_OPTION");
    if (flags.includes(key)) values.set(key, true);
    else if (
      [
        "--base",
        "--model",
        "--reset-module",
        "--report-prefix",
        "--history",
        "--references",
        "--before",
        "--before-references",
        "--credential-env",
      ].includes(key)
    ) {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error("CI_OPTION_VALUE");
      values.set(key, value);
    } else throw new Error("CI_UNKNOWN_OPTION");
  }
  const source = readTextInput(spec, 1048576),
    documents = values.has("--references")
      ? parseExact(readTextInput(values.get("--references"), 1048576))
      : {};
  if (action === "diff") {
    if (!values.has("--before")) throw new Error("CI_BEFORE_REQUIRED");
    const before = readTextInput(values.get("--before"), 1048576);
    try {
      console.log(
        JSON.stringify(
          contractDiff(parseExact(before), parseExact(source), {
            beforeDocuments: values.has("--before-references")
              ? parseExact(
                  readTextInput(values.get("--before-references"), 1048576),
                )
              : {},
            afterDocuments: documents,
          }),
          null,
          2,
        ),
      );
    } catch {
      console.log(
        JSON.stringify({
          full_suite_required: true,
          reason: "normalization_or_external_reference_uncertainty",
        }),
      );
    }
  } else {
    const options = {
      documents,
      allowWrite: values.has("--allow-write"),
      allowRemote: values.has("--allow-remote"),
      allowCallbacks: values.has("--allow-callbacks"),
      followLinks: values.has("--follow-links"),
    };
    const env = values.get("--credential-env");
    if (env) {
      if (
        !/^[A-Z_][A-Z0-9_]{0,127}$/.test(env) ||
        !process.env[env] ||
        Buffer.byteLength(process.env[env]) > 16384
      )
        throw new Error("CI_CREDENTIAL_ENV");
      options.credentials = JSON.parse(process.env[env]);
    }
    engine = await (
      ["workflow", "replay"].includes(action)
        ? StandardWorkflow
        : StandardEngine
    ).open(source, options);
    if (action === "discover")
      console.log(stringifyExact(await discoverDependencies(engine)));
    else {
      if (!values.has("--base")) throw new Error("CI_EXPLICIT_BASE_REQUIRED");
      let report;
      if (action === "run") {
        const hash = documentDigest(source, documents),
          known = engine.description.operations.map((o) => o.id);
        const history =
          values.has("--history") && fs.existsSync(values.get("--history"))
            ? parseExact(readTextInput(values.get("--history"), 65536))
            : undefined;
        report = await engine.runSelected(values.get("--base"), {
          operationIds: known,
          priority: historyPriority(history, hash, known),
        });
        if (values.has("--history")) {
          // History is deliberately append-only; choose a fresh path per CI run.
          writePrivate(
            values.get("--history") + ".next",
            historyFor(report, hash),
          );
        }
      } else {
        if (!values.has("--model")) throw new Error("CI_MODEL_REQUIRED");
        const model =
          action === "replay"
            ? loadReplay(values.get("--model"), { source, documents }).model
            : parseExact(readTextInput(values.get("--model"), 262144));
        let reset;
        if (values.has("--reset-module")) {
          if (!values.has("--allow-reset"))
            throw new Error("CI_RESET_NOT_AUTHORIZED");
          reset = (
            await import(
              pathToFileURL(path.resolve(values.get("--reset-module")))
            )
          ).reset;
        }
        report = await engine.run(values.get("--base"), model, {
          reset,
          allowReset: values.has("--allow-reset"),
          shrink: values.has("--shrink"),
        });
      }
      console.log(JSON.stringify(publicReport(report), null, 2));
      if (values.has("--report-prefix"))
        for (const [format, content] of Object.entries(renderReports(report)))
          fs.writeFileSync(
            values.get("--report-prefix") +
              "." +
              { junit: "xml", json: "json", html: "html" }[format],
            content,
            { flag: "wx", mode: 0o600 },
          );
      if (!report.passed) process.exitCode = 1;
    }
  }
} catch (error) {
  console.error(
    JSON.stringify({
      error: /^(?:CI|WORKFLOW|STANDARD|REPLAY)_[A-Z_]+$/.test(error.message)
        ? error.message
        : "CI_INPUT_OR_EXECUTION",
      contents_hidden: true,
    }),
  );
  process.exitCode = 2;
} finally {
  await engine?.close();
}

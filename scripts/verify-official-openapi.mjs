// READ-ONLY definition compatibility probe. Never calls API operations, sends
// credentials, creates resources, or changes the upstream demonstration server.
import { createHash } from "node:crypto";
import { StandardEngine } from "../platform/standard.mjs";
const url = "https://petstore3.swagger.io/api/v3/openapi.json";
const response = await fetch(url, {
  redirect: "error",
  signal: AbortSignal.timeout(20000),
});
if (!response.ok) throw new Error("Official definition download failed");
const chunks = [];
let length = 0;
for await (const chunk of response.body) {
  length += chunk.byteLength;
  if (length > 1048576) throw new Error("Definition byte budget exceeded");
  chunks.push(chunk);
}
const bytes = Buffer.concat(chunks),
  source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const engine = await StandardEngine.open(source);
try {
  const plan = await engine.plan();
  console.log(
    JSON.stringify(
      {
        source: url,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: length,
        document_valid: true,
        operations: engine.description.operations.length,
        cases: plan.cases.length,
        blocker_counts: Object.fromEntries(
          [...new Set(plan.blockers.map((b) => b.code))].map((code) => [
            code,
            plan.blockers.filter((b) => b.code === code).length,
          ]),
        ),
        full_openapi_support: plan.full_openapi_support,
        api_requests_executed: 0,
        production_or_user_pilot: false,
      },
      null,
      2,
    ),
  );
} finally {
  await engine.close();
}

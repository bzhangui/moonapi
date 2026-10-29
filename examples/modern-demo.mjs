// Reproducible local controls, not a real customer or production pilot.
// Only an ephemeral loopback server and synthetic values are used.
import assert from "node:assert/strict";
import http from "node:http";
import { StandardEngine } from "../platform/standard.mjs";
import { parseExact, stringifyExact } from "../platform/standard-value.mjs";

const threshold = parseExact("9223372036854775807");
const valueSchema = {
  type: "object",
  required: ["id", "tag"],
  properties: {
    id: { type: "integer", minimum: threshold },
    tag: { type: ["string", "null"], const: null },
  },
  additionalProperties: false,
};

function source(version) {
  const modernStream = version.startsWith("3.2.");
  const media = modernStream
    ? "application/x-ndjson; charset=utf-8"
    : "application/json; charset=utf-8";
  const ref = { $ref: "#/components/schemas/Value" };
  return stringifyExact({
    openapi: version,
    info: { title: "MoonAPI controlled native modern example", version: "1" },
    components: { schemas: { Value: valueSchema } },
    paths: {
      "/values": {
        [modernStream ? "query" : "get"]: {
          operationId: "values",
          responses: {
            200: {
              description: "Synthetic exact-number control",
              content: {
                [media]: modernStream
                  ? {
                      schema: { type: "array", minItems: 2, items: ref },
                      itemSchema: ref,
                    }
                  : {
                      schema: {
                        ...ref,
                        properties: { id: { minimum: threshold } },
                      },
                    },
              },
            },
          },
        },
      },
    },
  });
}

async function fixture(version, defect) {
  const stream = version.startsWith("3.2.");
  const server = http.createServer((request, response) => {
    request.resume();
    if (
      request.url !== "/values" ||
      request.method !== (stream ? "QUERY" : "GET")
    ) {
      response.writeHead(405).end();
      return;
    }
    const valid = '{"id":9223372036854775807,"tag":null}';
    const invalid = '{"id":9223372036854775806,"tag":null}';
    response.writeHead(200, {
      "content-type": stream
        ? "application/x-ndjson; charset=UTF-8"
        : "application/json; charset=UTF-8",
    });
    if (stream) {
      response.write(valid + "\n");
      response.end((defect ? invalid : valid) + "\n");
    } else response.end(defect ? invalid : valid);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

for (const version of ["3.1.2", "3.2.1"]) {
  for (const defect of [false, true]) {
    const local = await fixture(version, defect);
    let engine;
    try {
      engine = await StandardEngine.open(source(version));
      const report = await engine.run(local.base);
      assert.equal(
        report.passed,
        !defect,
        "Healthy and injected-fault controls must differ",
      );
      assert.equal(report.executed, report.planned);
      assert.deepEqual(report.blockers, []);
      if (version.startsWith("3.2.")) {
        assert.ok(report.records.every((record) => record.streamed));
        if (!defect)
          assert.ok(
            report.records.every((record) => record.stream_eof_verified),
          );
      }
      console.log(
        JSON.stringify({
          synthetic: true,
          external_real_pilot: false,
          openapi_version: version,
          defect,
          method: version.startsWith("3.2.") ? "QUERY" : "GET",
          planned: report.planned,
          executed: report.executed,
          failures: report.failed,
          expected_outcome_confirmed: true,
          full_openapi_support: report.full_openapi_support,
          third_party_certification: false,
        }),
      );
    } finally {
      await engine?.close();
      await local.close();
    }
  }
}

import test from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import http from "node:http";
import { X509Certificate, createPrivateKey } from "node:crypto";
import { syntheticPKI } from "./synthetic-pki.mjs";
import { standardHTTP, clientTLS } from "../platform/standard-http.mjs";
import { StandardEngine } from "../platform/standard.mjs";

function noSecret(result, pki) {
  const text = JSON.stringify(result);
  assert.equal(
    [
      pki.client.cert,
      pki.client.key,
      pki.ca,
      "BEGIN PRIVATE KEY",
      "BEGIN CERTIFICATE",
    ].some((secret) => text.includes(secret)),
    false,
    "TLS material leaked into public results",
  );
}
async function tlsFixture(
  pki,
  { requestCert = true, rejectUnauthorized = true } = {},
) {
  let requests = 0,
    failures = 0,
    peer;
  const sockets = new Set();
  const server = https.createServer(
    { ...pki.server, ca: pki.ca, requestCert, rejectUnauthorized },
    (req, res) => {
      requests++;
      const cert = req.socket.getPeerCertificate();
      peer = {
        authorized: req.socket.authorized,
        cn: cert?.subject?.CN,
        fingerprint: cert?.fingerprint256,
      };
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          peer: peer.cn ?? "none",
          authorized: peer.authorized,
        }),
      );
    },
  );
  server.on("tlsClientError", () => {
    failures++;
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    base: `https://127.0.0.1:${server.address().port}`,
    get requests() {
      return requests;
    },
    get failures() {
      return failures;
    },
    get peer() {
      return peer;
    },
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((r) => server.close(r));
    },
  };
}
const request = (security) => ({
  method: "GET",
  headers: {},
  tls: security,
  signal: AbortSignal.timeout(3000),
});
function description(version = "3.1.2") {
  return JSON.stringify({
    openapi: version,
    info: { title: "Synthetic in-memory mTLS fixture", version: "1" },
    components: { securitySchemes: { identity: { type: "mutualTLS" } } },
    security: [{ identity: [] }],
    paths: {
      "/identity": {
        get: {
          operationId: "identity",
          responses: {
            200: {
              description: "Synthetic authenticated peer",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["peer", "authorized"],
                    properties: {
                      peer: { type: "string" },
                      authorized: { const: true },
                    },
                    additionalProperties: false,
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
const input = { operation_id: "identity", parameters: [], negative: false };
function inboundDescription() {
  const document = JSON.parse(description("3.2.1"));
  document.webhooks = {
    event: {
      post: {
        operationId: "event",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["value"],
                properties: { value: { const: "synthetic" } },
                additionalProperties: false,
              },
            },
          },
        },
        responses: { 204: { description: "accepted" } },
      },
    },
  };
  return JSON.stringify(document);
}
test("test PKI is issued in memory with valid loopback names and distinct server/client usages", () => {
  const pki = syntheticPKI(),
    ca = new X509Certificate(pki.ca),
    server = new X509Certificate(pki.server.cert),
    client = new X509Certificate(pki.client.cert);
  assert.equal(ca.ca, true);
  assert.equal(server.checkIP("127.0.0.1"), "127.0.0.1");
  assert.equal(server.checkHost("localhost"), "localhost");
  assert.equal(server.checkHost("untrusted.invalid"), undefined);
  assert.equal(client.checkIssued(ca), true);
  assert.ok(server.keyUsage.includes("1.3.6.1.5.5.7.3.1"));
  assert.ok(client.keyUsage.includes("1.3.6.1.5.5.7.3.2"));
  assert.equal(pki.production_identity, false);
});
test("strict loopback mutual TLS presents and verifies the actual client certificate identity", async () => {
  const pki = syntheticPKI(),
    f = await tlsFixture(pki);
  try {
    const r = await standardHTTP(
      new URL(f.base + "/identity"),
      request(clientTLS({ ...pki.client, ca: pki.ca })),
    );
    assert.equal(r.status, 200);
    assert.equal(f.requests, 1);
    assert.equal(f.peer.authorized, true);
    assert.equal(f.peer.cn, pki.clientCN);
    assert.equal(f.peer.fingerprint, pki.clientFingerprint);
    noSecret({ status: r.status, peer_authorized: f.peer.authorized }, pki);
  } finally {
    await f.close();
  }
});
test("TLS trust failures, absent client certificates and foreign identities never reach the protected HTTP handler", async () => {
  const pki = syntheticPKI(),
    other = syntheticPKI({ label: "moonapi-foreign" }),
    f = await tlsFixture(pki);
  try {
    await assert.rejects(
      standardHTTP(
        new URL(f.base),
        request(clientTLS({ ...pki.client, ca: other.ca })),
      ),
    );
    await assert.rejects(
      standardHTTP(new URL(f.base), request(clientTLS({ ...pki.client }))),
    );
    await assert.rejects(
      standardHTTP(
        new URL(f.base),
        request({ ca: pki.ca, rejectUnauthorized: true }),
      ),
    );
    await assert.rejects(
      standardHTTP(
        new URL(f.base),
        request(clientTLS({ ...other.client, ca: pki.ca })),
      ),
    );
    await assert.rejects(
      standardHTTP(
        new URL(f.base),
        request(clientTLS({ ...pki.server, ca: pki.ca })),
      ),
    );
    assert.equal(f.requests, 0);
    const good = await standardHTTP(
      new URL(f.base),
      request(clientTLS({ ...pki.client, ca: pki.ca })),
    );
    assert.equal(good.status, 200);
    assert.equal(f.requests, 1);
  } finally {
    await f.close();
  }
});
test("loopback TLS still validates certificate names and validity windows rather than accepting a locally trusted issuer alone", async () => {
  for (const options of [
    { serverDNS: "not-loopback.invalid", serverIP: false },
    { now: Date.now() - 30 * 86400000 },
    { now: Date.now() + 30 * 86400000 },
  ]) {
    const pki = syntheticPKI(options),
      f = await tlsFixture(pki);
    try {
      await assert.rejects(
        standardHTTP(
          new URL(f.base),
          request(clientTLS({ ...pki.client, ca: pki.ca })),
        ),
      );
      assert.equal(f.requests, 0);
    } finally {
      await f.close();
    }
  }
});
test("TLS settings reject disabling verification, mismatched keys and plaintext transport before sending data", async () => {
  const pki = syntheticPKI(),
    other = syntheticPKI({ label: "moonapi-unrelated" });
  for (const value of [
    { ...pki.client, ca: pki.ca, rejectUnauthorized: false },
    { cert: pki.client.cert, key: other.client.key, ca: pki.ca },
    { cert: pki.client.cert },
    { ...pki.client, passphrase: 123 },
    { ...pki.client, ca: "x".repeat(65537) },
  ])
    assert.throws(() => clientTLS(value), /STANDARD_TLS_CONFIGURATION/);
  let requests = 0,
    sent = false;
  const server = http.createServer((_req, res) => {
    requests++;
    res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    await assert.rejects(
      standardHTTP(new URL(`http://127.0.0.1:${server.address().port}`), {
        ...request(clientTLS({ ...pki.client, ca: pki.ca })),
        onSent: () => {
          sent = true;
        },
      }),
      /STANDARD_MUTUAL_TLS_REQUIRED/,
    );
    assert.equal(requests, 0);
    assert.equal(sent, false);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
test("encrypted in-memory client keys accept the explicit passphrase and wrong passphrases stay sanitized", async () => {
  const pki = syntheticPKI(),
    passphrase = "synthetic-only-passphrase",
    key = createPrivateKey(pki.client.key).export({
      format: "pem",
      type: "pkcs8",
      cipher: "aes-256-cbc",
      passphrase,
    }),
    f = await tlsFixture(pki);
  try {
    const configuration = clientTLS({
      cert: Buffer.from(pki.client.cert),
      key: Buffer.from(key),
      ca: Buffer.from(pki.ca),
      passphrase,
    });
    assert.equal(
      (await standardHTTP(new URL(f.base), request(configuration))).status,
      200,
    );
    assert.throws(
      () =>
        clientTLS({
          cert: pki.client.cert,
          key,
          ca: pki.ca,
          passphrase: "wrong-synthetic-value",
        }),
      /STANDARD_TLS_CONFIGURATION/,
    );
    assert.equal(f.requests, 1);
  } finally {
    await f.close();
  }
});
test("OpenAPI3.1 and3.2 mutualTLS execute end-to-end without disclosing TLS material in reports", async () => {
  const pki = syntheticPKI(),
    f = await tlsFixture(pki);
  try {
    for (const version of ["3.1.2", "3.2.1"]) {
      const engine = await StandardEngine.open(description(version), {
        credentials: { identity: { ...pki.client, ca: pki.ca } },
      });
      try {
        const r = await engine.execute(f.base, input);
        assert.equal(
          r.record?.passed,
          true,
          "authenticated request should satisfy its declared contract",
        );
        assert.equal(r.context.response.body.peer, pki.clientCN);
        assert.equal(r.context.response.body.authorized, true);
        noSecret(r, pki);
        noSecret(await engine.plan(), pki);
      } finally {
        await engine.close();
      }
    }
    assert.equal(f.requests, 2);
  } finally {
    await f.close();
  }
});
test("modern mutualTLS fails closed for missing identity, wrong CA and plaintext target", async () => {
  const pki = syntheticPKI(),
    foreign = syntheticPKI({ label: "moonapi-foreign-ca" }),
    f = await tlsFixture(pki);
  try {
    for (const credentials of [
      {},
      { identity: { ...pki.client, ca: foreign.ca } },
      { identity: { ...foreign.client, ca: pki.ca } },
    ]) {
      const engine = await StandardEngine.open(description(), { credentials });
      try {
        const r = await engine.execute(f.base, input);
        assert.notEqual(r.record?.passed, true);
        noSecret(r, pki);
      } finally {
        await engine.close();
      }
    }
    const engine = await StandardEngine.open(description(), {
      credentials: { identity: { ...pki.client, ca: pki.ca } },
    });
    let plaintextRequests = 0;
    const plaintext = http.createServer((_req, res) => {
      plaintextRequests++;
      res.end();
    });
    await new Promise((r) => plaintext.listen(0, "127.0.0.1", r));
    try {
      const r = await engine.execute(
        `http://127.0.0.1:${plaintext.address().port}`,
        input,
      );
      assert.notEqual(r.record?.passed, true);
      assert.equal(plaintextRequests, 0);
      noSecret(r, pki);
    } finally {
      await engine.close();
      await new Promise((r) => plaintext.close(r));
    }
    assert.equal(f.requests, 0);
  } finally {
    await f.close();
  }
});
test("real HTTPS webhooks authenticate peer trust and optional fingerprint pins before accepting content", async () => {
  const pki = syntheticPKI(),
    engine = await StandardEngine.open(inboundDescription(), {
      allowCallbacks: true,
      callbackTimeout: 30,
      callbackTLS: { ...pki.server, ca: pki.ca },
      credentials: {
        identity: { acceptedFingerprints: [pki.clientFingerprint] },
      },
    });
  let receiver;
  try {
    receiver = await engine.createWebhookReceiver("event");
    assert.ok(receiver.url.startsWith("https://127.0.0.1:"));
    const r = await standardHTTP(new URL(receiver.url), {
      ...request(clientTLS({ ...pki.client, ca: pki.ca })),
      method: "POST",
      headers: { "content-type": "application/json" },
      body: Buffer.from('{"value":"synthetic"}'),
    });
    assert.equal(r.status, 204);
    assert.equal(await receiver.settle(), true);
    assert.equal(receiver.records.length, 1);
    assert.equal(receiver.records[0].valid, true);
    noSecret(receiver.records, pki);
  } finally {
    await receiver?.close();
    await engine.close();
  }
});
test("HTTPS webhook authentication rejects absent and untrusted peers, wrong pins and plaintext receivers", async () => {
  const pki = syntheticPKI(),
    foreign = syntheticPKI({ label: "moonapi-inbound-foreign" });
  for (const options of [
    { client: undefined },
    { client: foreign.client },
    { client: pki.client, pins: ["not-the-synthetic-peer"] },
    { plaintext: true },
  ]) {
    const engine = await StandardEngine.open(inboundDescription(), {
      allowCallbacks: true,
      callbackTimeout: 30,
      ...(options.plaintext
        ? {}
        : { callbackTLS: { ...pki.server, ca: pki.ca } }),
      credentials: {
        identity: {
          acceptedFingerprints: options.pins ?? [pki.clientFingerprint],
        },
      },
    });
    let receiver;
    try {
      receiver = await engine.createWebhookReceiver("event");
      const tls = options.plaintext
        ? undefined
        : options.client
          ? clientTLS({ ...options.client, ca: pki.ca })
          : { ca: pki.ca, rejectUnauthorized: true };
      const r = await standardHTTP(new URL(receiver.url), {
        ...request(tls),
        method: "POST",
        headers: { "content-type": "application/json" },
        body: Buffer.from('{"value":"synthetic"}'),
      });
      assert.equal(r.status, 401);
      assert.equal(await receiver.settle(), false);
      assert.equal(receiver.records[0].valid, false);
      noSecret(receiver.records, pki);
    } finally {
      await receiver?.close();
      await engine.close();
    }
  }
});
test("generated HTTPS callback URLs complete real mTLS round trips and unauthorized callbacks cannot make the parent case green", async () => {
  const pki = syntheticPKI(),
    foreign = syntheticPKI({ label: "moonapi-callback-foreign" });
  for (const bad of [false, true]) {
    let callbackStatus, destination;
    const server = http.createServer(async (req, res) => {
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString());
        destination = new URL(body.url);
        const response = await standardHTTP(destination, {
          ...request(
            clientTLS({ ...(bad ? foreign.client : pki.client), ca: pki.ca }),
          ),
          method: "POST",
          headers: { "content-type": "application/json" },
          body: Buffer.from('{"value":"synthetic"}'),
        });
        callbackStatus = response.status;
        res
          .writeHead(201, { "content-type": "application/json" })
          .end('{"ok":true}');
      } catch {
        res.writeHead(500).end();
      }
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const hook = JSON.parse(inboundDescription()).webhooks.event;
    const source = JSON.stringify({
      openapi: "3.2.1",
      info: { title: "Synthetic mutual TLS callback", version: "1" },
      components: { securitySchemes: { identity: { type: "mutualTLS" } } },
      paths: {
        "/register": {
          post: {
            operationId: "register",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["url"],
                    properties: { url: { type: "string", format: "uri" } },
                  },
                },
              },
            },
            callbacks: {
              done: {
                "{$request.body#/url}": {
                  ...hook,
                  post: { ...hook.post, security: [{ identity: [] }] },
                },
              },
            },
            responses: {
              201: {
                description: "created",
                content: {
                  "application/json": { schema: { const: { ok: true } } },
                },
              },
            },
          },
        },
      },
    });
    const engine = await StandardEngine.open(source, {
      allowWrite: true,
      allowCallbacks: true,
      callbackTimeout: 50,
      callbackTLS: { ...pki.server, ca: pki.ca },
      credentials: {
        identity: { acceptedFingerprints: [pki.clientFingerprint] },
      },
    });
    try {
      const r = await engine.execute(
        `http://127.0.0.1:${server.address().port}`,
        {
          operation_id: "register",
          parameters: [],
          negative: false,
          media: "application/json",
          body: { url: "https://not-called.invalid/callback" },
        },
      );
      assert.equal(destination.protocol, "https:");
      assert.equal(destination.hostname, "127.0.0.1");
      assert.equal(callbackStatus, bad ? 401 : 204);
      assert.equal(r.record.passed, !bad);
      assert.equal(r.record.callbacks_valid, !bad);
      noSecret(r.record, pki);
    } finally {
      await engine.close();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  encodeTransfer,
  decodeTransfer,
} from "../platform/standard-transfer.mjs";
import { cloneExact, parseExact, equal } from "../platform/standard-value.mjs";
import {
  digestExact,
  saveEncryptedWitness,
  loadEncryptedWitness,
} from "../platform/private-store.mjs";
import { loadConfirmedWitness } from "../platform/confirmed-witness.mjs";
import { documentDigest } from "../platform/ci-tools.mjs";
import { VERSION } from "../platform/runner.mjs";
import { inputProtection } from "../platform/input-protection.mjs";

test("worker frames preserve bytes and exact decimals without recognizing business Buffer lookalikes", () => {
  const value = {
    payload: Buffer.from([0, 128, 255]),
    view: new Uint8Array([7, 8]),
    number: parseExact("9223372036854775807"),
    lookalike: { type: "Buffer", data: [0, 128, 255] },
    list: [null, Buffer.from("中文", "utf8")],
  };
  const frame = encodeTransfer(value),
    result = decodeTransfer(structuredClone(frame));
  assert.ok(equal(value, result));
  assert.ok(Buffer.isBuffer(result.payload));
  assert.equal(String(result.number), "9223372036854775807");
  assert.equal(Buffer.isBuffer(result.lookalike), false);
  assert.equal(equal(result.payload, result.lookalike), false);
  result.payload[0] = 42;
  assert.equal(value.payload[0], 0);
  for (const unsupported of [
    new Date(0),
    new Map(),
    new Set(),
    new Uint16Array([1]),
    NaN,
    Infinity,
    -Infinity,
    () => 0,
    Symbol("synthetic"),
    1n,
  ])
    assert.throws(
      () => encodeTransfer({ unsupported }),
      /STANDARD_TRANSFER_VALUE/,
    );
  let getterCalled = false;
  const accessor = {
    get payload() {
      getterCalled = true;
      return Buffer.from("not-read");
    },
  };
  assert.throws(() => encodeTransfer(accessor), /STANDARD_TRANSFER_VALUE/);
  assert.equal(getterCalled, false);
  const hidden = [1];
  Object.defineProperty(hidden, "0", { enumerable: false });
  for (const sparse of [
    new Array(2),
    [1, ,],
    Object.assign([1], { extra: Buffer.from("not-json") }),
    hidden,
  ])
    assert.throws(() => encodeTransfer({ sparse }), /STANDARD_TRANSFER_VALUE/);
});

test("binary frame pointers round-trip escaped and NUL property names without prototype mutation", () => {
  const value = parseExact('{"__proto__":null,"a/b~}":null,"nested":{}}');
  value["__proto__"] = Buffer.from("proto literal");
  value["a/b~}"] = Buffer.from("escaped");
  value.nested["nul" + String.fromCharCode(0) + "key"] =
    Buffer.from("nul literal");
  const result = decodeTransfer(encodeTransfer(value));
  assert.ok(equal(value, result));
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(Object.prototype.polluted, undefined);
});

test("typed digest descriptors prevent NUL delimiter collisions between distinct binary placements", () => {
  const z = String.fromCharCode(0),
    key = "a" + z + "1" + z + "x" + z;
  const a = { a: Buffer.from("x"), b: Buffer.from("y"), [key]: { b: null } };
  const b = { a: null, b: null, [key]: { b: Buffer.from("y") } };
  assert.equal(equal(a, b), false);
  assert.equal(encodeTransfer(a).json, encodeTransfer(b).json);
  assert.notEqual(digestExact(a), digestExact(b));
  assert.notEqual(
    digestExact(Buffer.from([1])),
    digestExact({ type: "Buffer", data: [1] }),
  );
  assert.equal(digestExact(a), digestExact(cloneExact(a)));
});

test("binary-bearing clones and source locks snapshot LosslessNumber independently", () => {
  const n = parseExact("9223372036854775807"),
    body = { n, bytes: Buffer.from("owned"), marker: "controlled-source-lock" };
  const copied = cloneExact(body);
  const model = {
    version: 2,
    steps: [
      {
        id: "create",
        request: { parameters: [], body },
        ownership: { allowed: [body.marker] },
      },
    ],
    input_protection: [{ step: "create", target: "$request.body" }],
  };
  const protection = inputProtection(model);
  assert.equal(protection.complete, true);
  assert.equal(protection.allows(model.steps), true);
  assert.notEqual(copied.n, n);
  n.value = "1";
  assert.equal(String(copied.n), "9223372036854775807");
  assert.equal(protection.allows(model.steps), false);
  copied.bytes[0] = 0;
  assert.equal(body.bytes[0], "o".charCodeAt(0));
});

test("encrypted binary witness v3 authenticates typed round-trip and retains confirmed payload pinning", () => {
  const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "moonapi-binary-witness-"),
    ),
    key = randomBytes(32),
    file = path.join(directory, "witness.json"),
    source = "synthetic-source-only";
  try {
    const model = {
      version: 2,
      steps: [
        {
          id: "binary",
          request: {
            operation_id: "controlled",
            parameters: [],
            body: {
              bytes: Buffer.from([0, 255, 1]),
              n: parseExact("9223372036854775807"),
              note: "private-controlled-body",
            },
          },
        },
      ],
    };
    const witness = {
      format: 2,
      confirmed: true,
      engine_version: VERSION,
      document_hash: documentDigest(source),
      model_hash: digestExact(model),
      model,
      ir_version: 2,
      seed: 42,
      fingerprint: "a".repeat(64),
    };
    saveEncryptedWitness(file, witness, key);
    const envelope = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(envelope.format, 3);
    assert.equal(
      fs.readFileSync(file, "utf8").includes("private-controlled-body"),
      false,
    );
    const result = loadEncryptedWitness(file, key);
    assert.ok(equal(result, witness));
    assert.equal(
      String(result.model.steps[0].request.body.n),
      "9223372036854775807",
    );
    const confirmed = loadConfirmedWitness(file, key, { source });
    assert.equal(confirmed.automatic_write_replay, false);
    assert.ok(Buffer.isBuffer(confirmed.model.steps[0].request.body.bytes));
    const ciphertext = Buffer.from(envelope.data, "base64");
    ciphertext[0] ^= 1;
    fs.writeFileSync(
      path.join(directory, "tampered.json"),
      JSON.stringify({ ...envelope, data: ciphertext.toString("base64") }),
    );
    assert.throws(
      () => loadEncryptedWitness(path.join(directory, "tampered.json"), key),
      /AUTHENTICATION_OR_FILE/,
    );
    fs.writeFileSync(
      path.join(directory, "downgraded.json"),
      JSON.stringify({ ...envelope, format: 2 }),
    );
    assert.throws(
      () => loadEncryptedWitness(path.join(directory, "downgraded.json"), key),
      /AUTHENTICATION_OR_FILE/,
    );
    assert.throws(
      () => loadEncryptedWitness(file, randomBytes(32)),
      /AUTHENTICATION_OR_FILE/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test("existing JSON-only encrypted witness v2 remains compatible and exact", () => {
  const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "moonapi-json-witness-"),
    ),
    key = randomBytes(32),
    file = path.join(directory, "witness.json");
  try {
    const payload = {
      format: 2,
      n: parseExact("9223372036854775807"),
      data: { type: "Buffer", data: [1, 2] },
    };
    saveEncryptedWitness(file, payload, key);
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).format, 2);
    const result = loadEncryptedWitness(file, key);
    assert.ok(equal(payload, result));
    assert.equal(Buffer.isBuffer(result.data), false);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test("legacy and typed frames enforce total byte budgets and reject forged or overlapping binary slots", () => {
  assert.throws(
    () => decodeTransfer(JSON.stringify("x".repeat(100)), 1),
    /BUDGET/,
  );
  assert.throws(() => encodeTransfer(Buffer.alloc(16), 16), /BUDGET/);
  assert.throws(
    () => decodeTransfer(encodeTransfer(Buffer.alloc(16)), 16),
    /BUDGET|ENCODING/,
  );
  // Binary payload bytes are not the whole frame: repeated long JSON Pointer
  // locations must also consume the budget on both sides of the bridge.
  const longPaths = {
    ["p".repeat(200)]: Array.from({ length: 20 }, () => Buffer.from([1])),
  };
  assert.throws(() => encodeTransfer(longPaths, 1024), /BUDGET/);
  assert.throws(
    () => decodeTransfer(encodeTransfer(longPaths), 1024),
    /BUDGET|ENCODING/,
  );
  for (const frame of [
    {
      format: 1,
      json: '{"x":1}',
      binaries: [{ path: "/x", data: Buffer.from("x") }],
    },
    {
      format: 1,
      json: '{"x":null}',
      binaries: [
        { path: "/x", data: Buffer.from("x") },
        { path: "/x", data: Buffer.from("y") },
      ],
    },
    {
      format: 1,
      json: '{"x":null}',
      binaries: [{ path: "/x~2", data: Buffer.from("x") }],
    },
    {
      format: 1,
      json: '{"x":null}',
      binaries: [{ path: "/missing/x", data: Buffer.from("x") }],
    },
    {
      format: 1,
      json: "true",
      binaries: [{ path: "", data: Buffer.from("x") }],
    },
  ])
    assert.throws(() => decodeTransfer(frame), /ENCODING/);
});

test("legacy and typed frame decoding apply the same structural depth and node budgets as encoding", () => {
  const nested = "[".repeat(200) + "0" + "]".repeat(200);
  assert.throws(() => decodeTransfer(nested), /BUDGET/);
  assert.throws(
    () => decodeTransfer({ format: 1, json: nested, binaries: [] }),
    /BUDGET/,
  );
  const wide = "[" + Array.from({ length: 100000 }, () => "0").join(",") + "]";
  assert.throws(() => decodeTransfer(wide), /BUDGET/);
});

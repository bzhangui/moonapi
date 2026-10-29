// Disposable test-only X.509 material, generated entirely in memory. No private
// keys/certificates are fixtures on disk, and no OpenSSL CLI/network is needed.
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
  X509Certificate,
} from "node:crypto";

const bytes = (value) => (Buffer.isBuffer(value) ? value : Buffer.from(value));
const concat = (values) => Buffer.concat(values.map(bytes));
function length(size) {
  if (size < 128) return Buffer.from([size]);
  const octets = [];
  for (let n = size; n; n >>>= 8) octets.unshift(n & 255);
  return Buffer.from([0x80 | octets.length, ...octets]);
}
function der(tag, content) {
  content = bytes(content);
  return concat([Buffer.from([tag]), length(content.length), content]);
}
const sequence = (...values) => der(0x30, concat(values));
const set = (...values) => der(0x31, concat(values));
function integer(value) {
  let buffer = Buffer.isBuffer(value) ? value : Buffer.from([value]);
  while (buffer.length > 1 && buffer[0] === 0 && !(buffer[1] & 0x80))
    buffer = buffer.subarray(1);
  if (buffer[0] & 0x80) buffer = concat([Buffer.from([0]), buffer]);
  return der(0x02, buffer);
}
function oid(value) {
  const arcs = value.split(".").map(Number),
    body = [arcs[0] * 40 + arcs[1]];
  for (const arc of arcs.slice(2)) {
    const encoded = [arc & 127];
    for (let n = Math.floor(arc / 128); n; n = Math.floor(n / 128))
      encoded.unshift((n & 127) | 128);
    body.push(...encoded);
  }
  return der(0x06, Buffer.from(body));
}
const utf8 = (value) => der(0x0c, Buffer.from(value, "utf8"));
const distinguishedName = (cn) =>
  sequence(set(sequence(oid("2.5.4.3"), utf8(cn))));
const bitString = (value, unused = 0) =>
  der(0x03, concat([Buffer.from([unused]), value]));
function time(value) {
  const stamp = value
    .toISOString()
    .replace(/[-:T]/g, "")
    .replace(/\.\d{3}/, "");
  return value.getUTCFullYear() < 2050
    ? der(0x17, Buffer.from(stamp.slice(2)))
    : der(0x18, Buffer.from(stamp));
}
function extension(id, value, critical = false) {
  return sequence(
    oid(id),
    ...(critical ? [der(0x01, Buffer.from([0xff]))] : []),
    der(0x04, value),
  );
}
function pem(label, value) {
  return (
    "-----BEGIN " +
    label +
    "-----\n" +
    value
      .toString("base64")
      .match(/.{1,64}/g)
      .join("\n") +
    "\n-----END " +
    label +
    "-----\n"
  );
}
function pair() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const publicDER = publicKey.export({ type: "spki", format: "der" });
  return {
    privateKey,
    publicKey,
    publicDER,
    id: createHash("sha1").update(publicDER).digest(),
    key: privateKey.export({ type: "pkcs8", format: "pem" }),
  };
}
function certificate(
  subject,
  issuer,
  {
    ca = false,
    server = false,
    client = false,
    cn,
    issuerCN,
    now,
    serverDNS = "localhost",
    serverIP = true,
  },
) {
  const algorithm = sequence(oid("1.2.840.10045.4.3.2")); // ecdsa-with-SHA256, absent parameters
  const extensions = [
    extension(
      "2.5.29.19",
      ca ? sequence(der(0x01, Buffer.from([0xff])), integer(0)) : sequence(),
      true,
    ),
    extension(
      "2.5.29.15",
      bitString(Buffer.from([ca ? 0x06 : 0x80]), ca ? 1 : 7),
      true,
    ),
    extension("2.5.29.14", der(0x04, subject.id)),
    extension("2.5.29.35", sequence(der(0x80, issuer.id))),
  ];
  if (server || client)
    extensions.push(
      extension(
        "2.5.29.37",
        sequence(
          ...[
            ...(server ? [oid("1.3.6.1.5.5.7.3.1")] : []),
            ...(client ? [oid("1.3.6.1.5.5.7.3.2")] : []),
          ],
        ),
      ),
    );
  if (server)
    extensions.push(
      extension(
        "2.5.29.17",
        sequence(
          der(0x82, Buffer.from(serverDNS)),
          ...(serverIP ? [der(0x87, Buffer.from([127, 0, 0, 1]))] : []),
        ),
      ),
    );
  const start = new Date(now - 24 * 3600000),
    end = new Date(now + 7 * 24 * 3600000);
  const tbs = sequence(
    der(0xa0, integer(2)),
    integer(randomBytes(16)),
    algorithm,
    distinguishedName(issuerCN),
    sequence(time(start), time(end)),
    distinguishedName(cn),
    subject.publicDER,
    der(0xa3, sequence(...extensions)),
  );
  return pem(
    "CERTIFICATE",
    sequence(tbs, algorithm, bitString(sign("sha256", tbs, issuer.privateKey))),
  );
}
export function syntheticPKI({
  label = "moonapi-synthetic",
  now = Date.now(),
  serverDNS = "localhost",
  serverIP = true,
} = {}) {
  if (
    typeof label !== "string" ||
    !/^[a-z0-9-]{1,64}$/.test(label) ||
    !Number.isSafeInteger(now) ||
    typeof serverDNS !== "string" ||
    !/^[a-z0-9.-]{1,253}$/.test(serverDNS) ||
    typeof serverIP !== "boolean"
  )
    throw new Error("SYNTHETIC_PKI_OPTIONS");
  const ca = pair(),
    server = pair(),
    client = pair(),
    rootCN = label + "-ca",
    clientCN = label + "-client";
  const caCert = certificate(ca, ca, {
    ca: true,
    cn: rootCN,
    issuerCN: rootCN,
    now,
  });
  const serverCert = certificate(server, ca, {
    server: true,
    cn: label + "-server",
    issuerCN: rootCN,
    now,
    serverDNS,
    serverIP,
  });
  const clientCert = certificate(client, ca, {
    client: true,
    cn: clientCN,
    issuerCN: rootCN,
    now,
  });
  if (
    !new X509Certificate(caCert).ca ||
    !new X509Certificate(serverCert).verify(ca.publicKey) ||
    !new X509Certificate(clientCert).verify(ca.publicKey)
  )
    throw new Error("SYNTHETIC_PKI_SELF_CHECK");
  return {
    ca: caCert,
    server: { cert: serverCert, key: server.key },
    client: { cert: clientCert, key: client.key },
    clientCN,
    clientFingerprint: new X509Certificate(clientCert).fingerprint256,
    synthetic: true,
    production_identity: false,
  };
}

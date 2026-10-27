import fs from "node:fs";
import path from "node:path";
import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHash,
} from "node:crypto";
import { parseExact, stringifyExact } from "./standard-value.mjs";
export function privateDirectory(folder, { create = false } = {}) {
  let absolute = path.resolve(folder);
  // Darwin exposes its system temporary tree through root-owned /var and /tmp
  // aliases. Accept only these exact OS mappings, never arbitrary user links.
  if (process.platform === "darwin")
    for (const [alias, target] of [
      ["/var", "/private/var"],
      ["/tmp", "/private/tmp"],
    ]) {
      if (absolute === alias || absolute.startsWith(alias + "/")) {
        const stat = fs.lstatSync(alias);
        if (stat.isSymbolicLink()) {
          if (stat.uid !== 0 || fs.realpathSync(alias) !== target)
            throw new Error("PRIVATE_DIRECTORY_LINK");
          absolute = target + absolute.slice(alias.length);
        }
        break;
      }
    }
  const parts = absolute
    .slice(path.parse(absolute).root.length)
    .split(path.sep)
    .filter(Boolean);
  let current = path.parse(absolute).root;
  for (const part of parts) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) {
      if (!create) throw new Error("PRIVATE_DIRECTORY_MISSING");
      fs.mkdirSync(current, { mode: 0o700 });
    }
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("PRIVATE_DIRECTORY_LINK");
  }
  return fs.realpathSync(absolute);
}
export function atomicPrivate(file, value, { maxBytes = 1048576 } = {}) {
  const parent = privateDirectory(path.dirname(file)),
    target = path.join(parent, path.basename(file));
  const text = typeof value === "string" ? value : stringifyExact(value);
  if (Buffer.byteLength(text) > maxBytes)
    throw new Error("PRIVATE_ARTIFACT_BUDGET");
  const temporary = path.join(
    parent,
    ".moonapi-" + randomBytes(16).toString("hex") + ".tmp",
  );
  let fd;
  try {
    fd = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(fd, text);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    // Atomic no-replace commit, unlike an exists-check followed by rename.
    fs.linkSync(temporary, target);
    fs.unlinkSync(temporary);
    try {
      const directory = fs.openSync(parent, "r");
      try {
        fs.fsyncSync(directory);
      } finally {
        fs.closeSync(directory);
      }
    } catch {}
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
export function readPrivate(file, maxBytes = 1048576) {
  privateDirectory(path.dirname(file));
  const stat = fs.lstatSync(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.size > maxBytes
  )
    throw new Error("PRIVATE_ARTIFACT_FILE");
  const fd = fs.openSync(
    file,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
  );
  try {
    const opened = fs.fstatSync(fd);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.size > maxBytes ||
      opened.ino !== stat.ino ||
      opened.dev !== stat.dev
    )
      throw new Error("PRIVATE_ARTIFACT_FILE");
    return fs.readFileSync(fd, "utf8");
  } finally {
    fs.closeSync(fd);
  }
}
export const digestExact = (value) =>
  createHash("sha256").update(stringifyExact(value)).digest("hex");
export function saveEncryptedWitness(file, witness, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32)
    throw new Error("WITNESS_KEY_REQUIRED");
  const nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from("MoonAPI witness v2"));
  const raw = stringifyExact(witness);
  if (Buffer.byteLength(raw) > 524288) throw new Error("WITNESS_BUDGET");
  const encrypted = Buffer.concat([cipher.update(raw, "utf8"), cipher.final()]);
  atomicPrivate(file, {
    format: 2,
    encrypted: true,
    algorithm: "aes-256-gcm",
    nonce: nonce.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
  });
}
export function loadEncryptedWitness(file, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32)
    throw new Error("WITNESS_KEY_REQUIRED");
  try {
    const envelope = JSON.parse(readPrivate(file));
    if (
      envelope.format !== 2 ||
      envelope.encrypted !== true ||
      envelope.algorithm !== "aes-256-gcm"
    )
      throw new Error();
    const nonce = Buffer.from(envelope.nonce, "base64"),
      tag = Buffer.from(envelope.tag, "base64");
    if (nonce.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(Buffer.from("MoonAPI witness v2"));
    decipher.setAuthTag(tag);
    return parseExact(
      Buffer.concat([
        decipher.update(Buffer.from(envelope.data, "base64")),
        decipher.final(),
      ]).toString("utf8"),
    );
  } catch {
    throw new Error("WITNESS_AUTHENTICATION_OR_FILE");
  }
}

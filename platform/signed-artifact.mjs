// A caller supplies the trust anchor out-of-band. Never trust a public key
// embedded in an artifact or infer project identity from a passing signature.
import {
  sign,
  verify,
  createPublicKey,
  createPrivateKey,
  createHash,
} from "node:crypto";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function signArtifact(bytes, privateKey) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 16777216)
    throw new Error("ARTIFACT_BUDGET");
  const key = createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("ARTIFACT_KEY");
  const digest = sha(bytes),
    message = Buffer.from("MoonAPI artifact v1\0" + digest);
  return {
    format: 1,
    algorithm: "ed25519",
    sha256: digest,
    signature: sign(null, message, key).toString("base64"),
    identity_certified: false,
  };
}
export function verifyArtifact(bytes, signature, trustedPublicKey) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 16777216)
    throw new Error("ARTIFACT_BUDGET");
  try {
    const key = createPublicKey(trustedPublicKey);
    if (
      key.asymmetricKeyType !== "ed25519" ||
      signature?.format !== 1 ||
      signature.algorithm !== "ed25519" ||
      signature.identity_certified !== false ||
      signature.sha256 !== sha(bytes) ||
      typeof signature.signature !== "string" ||
      !/^[A-Za-z0-9+/]{86}==$/.test(signature.signature)
    )
      return false;
    return verify(
      null,
      Buffer.from("MoonAPI artifact v1\0" + signature.sha256),
      key,
      Buffer.from(signature.signature, "base64"),
    );
  } catch {
    return false;
  }
}

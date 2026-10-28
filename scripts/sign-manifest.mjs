// Optional offline signing only. No key generation, network, publication or
// project identity assertion. Keep signature sidecars OUTSIDE the runtime.
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  readPrivate,
  privateDirectory,
  atomicPrivate,
} from "../platform/private-store.mjs";
import { signArtifact, verifyArtifact } from "../platform/signed-artifact.mjs";
try {
  const [action, bundle, keyFile, sidecar, ...extra] = process.argv.slice(2);
  if (
    !["sign", "verify"].includes(action) ||
    !bundle ||
    !keyFile ||
    !sidecar ||
    extra.length
  )
    throw new Error();
  const root = privateDirectory(bundle),
    requestedSidecar = path.resolve(sidecar),
    signatureFile = path.join(
      privateDirectory(path.dirname(requestedSidecar)),
      path.basename(requestedSidecar),
    ),
    relative = path.relative(root, signatureFile);
  // Compare physical parents, not /var vs /private/var aliases. path.relative
  // also respects Windows case-insensitive drive/path containment semantics.
  if (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(".." + path.sep))
  )
    throw new Error();
  const verified = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./verify-package.mjs", import.meta.url)), root],
    { encoding: "utf8", timeout: 30000, windowsHide: true },
  );
  if (verified.status !== 0) throw new Error();
  const bytes = Buffer.from(readPrivate(path.join(root, "manifest.json"))),
    key = readPrivate(keyFile, 16384);
  if (action === "sign") {
    const value = signArtifact(bytes, key);
    atomicPrivate(signatureFile, value);
  } else if (
    !verifyArtifact(bytes, JSON.parse(readPrivate(signatureFile, 4096)), key)
  )
    throw new Error();
  console.log(
    JSON.stringify({
      verified: true,
      action,
      trust_anchor: "caller supplied out-of-band",
      identity_certified: false,
      publicly_uploaded: false,
    }),
  );
} catch {
  console.error("ARTIFACT_SIGNATURE_OR_PACKAGE_INVALID_CONTENTS_HIDDEN");
  process.exitCode = 2;
}

import { loadEncryptedWitness, digestExact } from "./private-store.mjs";
import { documentDigest } from "./ci-tools.mjs";
import { VERSION } from "./runner.mjs";
// Loading is intentionally not execution and grants no write/reset permission.
export function loadConfirmedWitness(
  file,
  key,
  { source, documents = {}, engineVersion = VERSION } = {},
) {
  const w = loadEncryptedWitness(file, key);
  if (
    w.format !== 2 ||
    w.confirmed !== true ||
    w.engine_version !== engineVersion ||
    w.document_hash !== documentDigest(source, documents) ||
    w.model_hash !== digestExact(w.model) ||
    w.ir_version !== w.model?.version ||
    ![1, 2].includes(w.ir_version) ||
    !Number.isInteger(w.seed) ||
    w.seed < 0 ||
    w.seed > 1000000 ||
    typeof w.fingerprint !== "string" ||
    !/^[0-9a-f]{64}$/.test(w.fingerprint)
  )
    throw new Error("WITNESS_PIN_MISMATCH");
  return {
    model: w.model,
    seed: w.seed,
    fingerprint: w.fingerprint,
    automatic_write_replay: false,
  };
}

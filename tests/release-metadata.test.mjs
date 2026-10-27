import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { releaseMetadata } from "../scripts/release-metadata.mjs";
test("local SBOM and provenance cover the locked graph, hide local paths and make no signature/publication claim", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "moonapi-metadata-"));
  try {
    releaseMetadata(dir);
    const sbom = JSON.parse(fs.readFileSync(path.join(dir, "sbom.cdx.json"))),
      provenance = JSON.parse(
        fs.readFileSync(path.join(dir, "provenance.json")),
      ),
      lock = JSON.parse(
        fs.readFileSync(new URL("../package-lock.json", import.meta.url)),
      );
    assert.equal(sbom.specVersion, "1.6");
    assert.equal(sbom.components.length, Object.keys(lock.packages).length - 1);
    assert.equal(
      new Set(sbom.components.map((x) => x["bom-ref"])).size,
      sbom.components.length,
    );
    for (const item of sbom.components) {
      assert.ok(item.name && item.version && item.licenses[0].expression);
      assert.equal(item.hashes[0].content.length, 128);
    }
    assert.match(provenance.source_commit, /^[0-9a-f]{40}$/);
    assert.match(provenance.lock_sha256, /^[0-9a-f]{64}$/);
    assert.equal(provenance.signed, false);
    assert.equal(provenance.registry_published, false);
    assert.equal(provenance.public_runtime_uploaded, false);
    assert.ok(!JSON.stringify(provenance).includes(process.cwd()));
    assert.throws(() => releaseMetadata(dir));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

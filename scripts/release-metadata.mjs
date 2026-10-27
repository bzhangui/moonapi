import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
export function releaseMetadata(destination) {
  const lock = JSON.parse(
    fs.readFileSync(path.join(root, "package-lock.json"), "utf8"),
  );
  const components = Object.entries(lock.packages)
    .filter(([name]) => name)
    .map(([location, pkg]) => ({
      type: "library",
      "bom-ref": location,
      name: location.slice(location.lastIndexOf("node_modules/") + 13),
      version: pkg.version,
      licenses: [{ expression: pkg.license }],
      hashes: pkg.integrity?.startsWith("sha512-")
        ? [
            {
              alg: "SHA-512",
              content: Buffer.from(pkg.integrity.slice(7), "base64").toString(
                "hex",
              ),
            },
          ]
        : [],
    }));
  const sbom = {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    metadata: {
      component: {
        type: "application",
        name: "MoonAPI",
        version: lock.version,
      },
    },
    components,
  };
  fs.writeFileSync(
    path.join(destination, "sbom.cdx.json"),
    JSON.stringify(sbom, null, 2),
    { flag: "wx" },
  );
  const git = (args) =>
    spawnSync("git", args, {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    }).stdout?.trim();
  const files = git(["ls-files", "-z"])
    .split("\0")
    .filter(Boolean)
    .filter((f) => !f.includes("申报书"));
  const source = createHash("sha256");
  for (const file of files.sort()) {
    const target = path.join(root, file);
    if (fs.existsSync(target) && fs.statSync(target).isFile())
      source.update(file + "\0").update(fs.readFileSync(target));
  }
  fs.writeFileSync(
    path.join(destination, "provenance.json"),
    JSON.stringify(
      {
        format: 1,
        source_repository: "https://github.com/bzhangui/moonapi",
        source_commit: git(["rev-parse", "HEAD"]),
        working_tree_clean:
          git(["status", "--porcelain", "--untracked-files=normal"]) === "",
        tracked_source_sha256: source.digest("hex"),
        lock_sha256: createHash("sha256")
          .update(fs.readFileSync(path.join(root, "package-lock.json")))
          .digest("hex"),
        node: process.versions.node,
        platform: process.platform,
        arch: process.arch,
        signed: false,
        registry_published: false,
        public_runtime_uploaded: false,
        claim:
          "Local build metadata, not signed provenance or reproducible-build certification.",
      },
      null,
      2,
    ),
    { flag: "wx" },
  );
}

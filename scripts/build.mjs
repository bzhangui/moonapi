import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertCompilerVersion } from "./compiler-version.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const sdkName = fs.existsSync(
  path.join(root, ".local", "toolchain-0.10.18", "bin"),
)
  ? "toolchain-0.10.18"
  : "toolchain";
const local = path.join(
  root,
  ".local",
  sdkName,
  "bin",
  process.platform === "win32" ? "moon.exe" : "moon",
);
export const moon =
  process.env.MOON_BIN ||
  (fs.existsSync(local)
    ? local
    : process.platform === "win32"
      ? "moon.exe"
      : "moon");
export const moonEnv = {
  ...process.env,
  ...(fs.existsSync(local) && !process.env.MOON_BIN
    ? { MOON_HOME: path.dirname(path.dirname(local)) }
    : {}),
};
export function run(cmd, args) {
  const r = spawnSync(cmd, args, {
    cwd: root,
    env: moonEnv,
    stdio: "inherit",
    shell: false,
  });
  if (r.error) throw r.error;
  if (r.status !== 0)
    throw new Error(
      "Command failed: " +
        cmd +
        " " +
        args.join(" ") +
        "; exit=" +
        r.status +
        "; signal=" +
        (r.signal || "none"),
    );
}
export function versionCheck() {
  const v = spawnSync(moon, ["version", "--all"], {
    encoding: "utf8",
    env: moonEnv,
  });
  if (v.status !== 0) throw new Error("MoonBit compiler unavailable");
  assertCompilerVersion(v.stdout);
  return v.stdout.trim();
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const nodeParts = process.versions.node.split(".").map(Number);
  if (nodeParts[0] < 22 || (nodeParts[0] === 22 && nodeParts[1] < 19))
    throw new Error("Node.js >= 22.19.0 required");
  versionCheck();
  const frozen = process.argv.includes("--frozen");
  if (!frozen) run(moon, ["update"]);
  run(moon, [
    "build",
    "--target",
    "js",
    "--release",
    "--deny-warn",
    ...(frozen ? ["--frozen"] : []),
  ]);
}

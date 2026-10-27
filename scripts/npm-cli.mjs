import fs from "node:fs";
import path from "node:path";
// Node's official Windows distribution puts npm beside node.exe; Unix puts
// npm under <prefix>/lib/node_modules, not <prefix>/bin/node_modules.
export function resolveNpmCLI({
  execPath = process.execPath,
  env = process.env,
} = {}) {
  const bin = path.dirname(execPath);
  const candidates = env.MOONAPI_NPM_CLI
    ? [env.MOONAPI_NPM_CLI]
    : [
        ...(env.npm_execpath?.endsWith("npm-cli.js") ? [env.npm_execpath] : []),
        path.join(bin, "node_modules/npm/bin/npm-cli.js"),
        path.join(bin, "../lib/node_modules/npm/bin/npm-cli.js"),
        ...(process.platform === "win32" ? [] : [path.join(bin, "npm")]),
      ];
  for (const candidate of candidates) {
    try {
      const real = fs.realpathSync(candidate);
      if (fs.statSync(real).isFile()) return real;
    } catch {}
  }
  throw new Error("NPM_CLI_NOT_FOUND");
}

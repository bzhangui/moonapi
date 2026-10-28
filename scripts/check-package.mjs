import { spawnSync } from "node:child_process";
import { moon, moonEnv } from "./build.mjs";
const result = spawnSync(moon, ["package", "--list", "--frozen"], {
  env: moonEnv,
  encoding: "utf8",
  maxBuffer: 8 * 1024 * 1024,
});
if (result.status !== 0) throw new Error("Package listing failed");
const names = (result.stdout + "\n" + result.stderr)
  .split(/\r?\n/)
  .filter((s) =>
    /^(?:LICENSE|NOTICE|README\.md|moon\.mod|package\.json|[^\s]+[\\/][^\s]+|[^\s]+\.(?:md|mjs|cmd))$/.test(
      s,
    ),
  );
if (
  names.some((s) =>
    /申报书|(?:^|[\\/])(?:\.local|\.moonapi-private|\.env[^\\/]*|credentials\.json|node_modules|\.git|_build|coverage)(?:[\\/]|$)|\.(?:pem|key|dpapi|intent\.json|disposition\.json)$/i.test(
      s,
    ),
  )
)
  throw new Error("Private member in publish archive");
if (!names.includes("LICENSE") || !names.includes("NOTICE"))
  throw new Error("Missing license notices");
console.log(
  JSON.stringify({
    publish_privacy_check: true,
    listed_entries: names.length,
    publicly_published: false,
  }),
);

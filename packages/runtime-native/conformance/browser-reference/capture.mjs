#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const conformanceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runner = resolve(conformanceRoot, "run-conformance.mjs");
const args = process.argv.slice(2);
const forwarded = [runner, "--target", "web"];
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--registry") {
    index += 1;
    continue;
  }
  forwarded.push(args[index]);
}
const result = spawnSync(process.execPath, forwarded, {
  cwd: resolve(conformanceRoot, ".."),
  encoding: "utf8",
  stdio: "inherit",
});
process.exitCode = result.status ?? 1;

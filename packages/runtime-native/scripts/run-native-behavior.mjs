#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function runNativeBehavior(executable, expectedProofs, args = []) {
  if (!executable) throw new Error("native behavior executable path is missing");
  if (!Array.isArray(expectedProofs) || expectedProofs.length === 0) {
    throw new Error("native behavior expected proof list is empty");
  }

  const result = spawnSync(executable, args, { encoding: "utf8" });
  const stderr = result.stderr.trim();
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `native behavior executable failed with exit ${result.status}: ${stderr || result.stdout.trim()}`,
    );
  }

  const proofs = result.stdout
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("proof: "))
    .map((line) => line.slice("proof: ".length));
  for (const expected of expectedProofs) {
    const count = proofs.filter((proof) => proof === expected).length;
    if (count === 0) throw new Error(`native behavior proof is missing: ${expected}`);
    if (count > 1) throw new Error(`native behavior proof is duplicated: ${expected}`);
  }
  return { proofs, stdout: result.stdout };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runNativeBehavior(process.argv[2], process.argv.slice(3));
}

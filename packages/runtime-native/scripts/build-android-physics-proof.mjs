#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(runtimeRoot, "..", "..");
const exampleRoot = join(workspaceRoot, "examples/native-smoke");
const bundle = join(exampleRoot, "dist/native-smoke.js");
const output = join(runtimeRoot, "android/app/src/main/assets/scripts/main.js");
const control = process.env.THREENATIVE_PHYSICS_CONTROL ?? "normal";
if (!["normal", "masked", "offset-box", "wrong-gravity"].includes(control))
  throw new Error(`Unsupported THREENATIVE_PHYSICS_CONTROL=${control}`);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? workspaceRoot,
    encoding: "utf8",
    env: options.env ?? process.env,
    maxBuffer: 64 * 1024 * 1024,
    timeout: 180_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(result.stderr || result.stdout || `${command} exited ${result.status}`);
}

const vite = join(exampleRoot, `node_modules/.bin/vite${process.platform === "win32" ? ".cmd" : ""}`);
const esbuild = join(
  runtimeRoot,
  `node_modules/.bin/esbuild${process.platform === "win32" ? ".cmd" : ""}`,
);
if (!existsSync(vite) || !existsSync(esbuild))
  throw new Error("Pinned Vite/esbuild dependencies are missing; run pnpm install --frozen-lockfile.");
run(vite, ["build", "--config", "vite.config.ts"], {
  cwd: exampleRoot,
  env: {
    ...process.env,
    THREENATIVE_PHYSICS_CONTROL: control,
    THREENATIVE_NATIVE_BACKEND: "enabled",
    THREENATIVE_PHYSICS_SCENE: "enabled",
  },
});
const source = readFileSync(bundle, "utf8");
for (const marker of [
  "TN_NATIVE_SMOKE_READY:webgpu",
  "TN_NATIVE_SMOKE_FIRST_FRAME",
  "TN_NATIVE_PHYSICS_PARITY",
]) {
  if (!source.includes(marker)) throw new Error(`Native physics bundle is missing ${marker}`);
}
if (/^\s*import\s+/m.test(source) || /\bimport\s*\(/.test(source))
  throw new Error("Native physics bundle contains a runtime import");
mkdirSync(dirname(output), { recursive: true });
run(esbuild, [bundle, "--minify", "--format=iife", "--platform=browser", "--target=es2022", `--outfile=${output}`]);
const built = readFileSync(output);
const sha256 = createHash("sha256").update(built).digest("hex");
writeFileSync(
  `${output}.meta.json`,
  `${JSON.stringify(
    {
      schemaVersion: 2,
      entry: "examples/native-smoke/src/physics.ts",
      publicApiPackage: "@threenative/physics",
      backendCondition: "threenative-native",
      sceneFlag: "THREENATIVE_PHYSICS_SCENE",
      control,
      outputBytes: built.length,
      outputSha256: sha256,
    },
    null,
    2,
  )}\n`,
);
console.info(`Android native physics bundle: ${control}, ${built.length} bytes, sha256=${sha256}`);

#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sharedPath = 'conformance/scenes/shared/first-proof-game.js';
const entryPath = 'conformance/android/first-proof-entry.js';
const outPath = 'android/app/src/main/assets/scripts/main.js';
const metaPath = `${outPath}.meta.json`;
const esbuildBin = process.platform === 'win32'
  ? join(root, 'node_modules/.bin/esbuild.cmd')
  : join(root, 'node_modules/.bin/esbuild');

for (const path of [sharedPath, entryPath]) {
  if (!existsSync(join(root, path))) {
    throw new Error(`Missing Android first proof input: ${path}`);
  }
}
if (!existsSync(esbuildBin)) {
  throw new Error('Missing pinned esbuild dependency. Run npm install/bun install before building Android assets.');
}

const sharedSource = readFileSync(join(root, sharedPath), 'utf8');
const sharedSha256 = createHash('sha256').update(sharedSource).digest('hex');
mkdirSync(dirname(join(root, outPath)), { recursive: true });

const banner = [
  '/*',
  'THREENATIVE_ANDROID_FIRST_PROOF_GENERATED: do not hand-edit; run node scripts/build-android-first-proof.mjs',
  `THREENATIVE_ANDROID_FIRST_PROOF_SHARED:${sharedPath}`,
  `THREENATIVE_ANDROID_FIRST_PROOF_ENTRY:${entryPath}`,
  `THREENATIVE_ANDROID_FIRST_PROOF_SOURCE_SHA256:${sharedSha256}`,
  'THREENATIVE_ANDROID_FIRST_PROOF_IMPORT:import * as THREE from \'three/webgpu\'',
  '*/',
].join('\n');

const proc = spawnSync(esbuildBin, [
  entryPath,
  '--bundle',
  '--format=cjs',
  '--platform=browser',
  '--target=es2020',
  '--minify',
  `--outfile=${outPath}`,
  `--banner:js=${banner}`,
  '--metafile=android/app/src/main/assets/scripts/main.js.meta.json',
  '--log-level=info',
], { cwd: root, encoding: 'utf8', timeout: 120000 });

if (proc.status !== 0) {
  process.stdout.write(proc.stdout || '');
  process.stderr.write(proc.stderr || '');
  process.exit(proc.status ?? 1);
}

const bundle = readFileSync(join(root, outPath), 'utf8');
if (!bundle.includes(`THREENATIVE_ANDROID_FIRST_PROOF_SOURCE_SHA256:${sharedSha256}`)) {
  throw new Error('Generated Android bundle is missing shared-source provenance hash');
}
if (/glb-parser|parseGLB|loadGLB|DamagedHelmet|PBR shader|textureSample\(baseColorTexture/i.test(bundle)) {
  throw new Error('Generated Android bundle unexpectedly contains the custom raw-WebGPU/GLB-parser gate');
}

const meta = JSON.parse(readFileSync(join(root, metaPath), 'utf8'));
const inputs = Object.keys(meta.inputs || {});
if (!inputs.some((input) => input.endsWith(sharedPath)) || !inputs.some((input) => input.includes('node_modules/three/'))) {
  throw new Error('Generated Android bundle metafile does not trace to the shared scene and upstream Three.js');
}

console.log(JSON.stringify({
  wrote: outPath,
  metafile: metaPath,
  sharedPath,
  entryPath,
  sharedSha256,
  bytes: bundle.length,
  inputs: inputs.length,
  relativeToRoot: relative(process.cwd(), join(root, outPath)),
}, null, 2));

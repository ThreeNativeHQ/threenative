#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = join(runtimeRoot, 'native', 'physics', 'Cargo.toml');
const targetDir = join(runtimeRoot, '.runtime', 'physics-target');
const gradleProperties = readFileSync(join(runtimeRoot, 'android', 'gradle.properties'), 'utf8');
const ndkVersion = gradleProperties.match(/^android\.ndkVersion=(.+)$/m)?.[1];
if (!ndkVersion) throw new Error('android/gradle.properties has no android.ndkVersion');

const sdkRoot = process.env.ANDROID_HOME
  ?? process.env.ANDROID_SDK_ROOT
  ?? join(homedir(), 'Android', 'Sdk');
const ndkRoot = process.env.ANDROID_NDK_HOME
  ?? process.env.ANDROID_NDK_ROOT
  ?? join(sdkRoot, 'ndk', ndkVersion);
const host = process.platform === 'darwin' ? 'darwin-x86_64'
  : process.platform === 'win32' ? 'windows-x86_64'
    : 'linux-x86_64';
const bin = join(ndkRoot, 'toolchains', 'llvm', 'prebuilt', host, 'bin');
if (!existsSync(bin)) throw new Error(`Android NDK toolchain not found: ${bin}`);

const targets = [
  ['aarch64-linux-android', 'aarch64-linux-android21-clang'],
  ['x86_64-linux-android', 'x86_64-linux-android21-clang'],
];
for (const [target, linkerName] of targets) {
  const linker = join(bin, `${linkerName}${process.platform === 'win32' ? '.cmd' : ''}`);
  const envName = `CARGO_TARGET_${target.toUpperCase().replaceAll('-', '_')}_LINKER`;
  const result = spawnSync(
    'cargo',
    ['build', '--release', '--manifest-path', manifest, '--target', target, '--target-dir', targetDir],
    { cwd: runtimeRoot, encoding: 'utf8', env: { ...process.env, [envName]: linker } },
  );
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `cargo exited ${result.status}`);
  const artifact = join(targetDir, target, 'release', 'libthreenative_native_physics.a');
  if (!existsSync(artifact)) throw new Error(`Cargo reported success without ${artifact}`);
  console.log(`${target}: ${basename(artifact)} ${statSync(artifact).size} bytes`);
}

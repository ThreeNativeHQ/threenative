#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { assertNativeAssetsDecodable, deriveDesktopWebpSupport } from './asset-preflight.mjs';

const runtimeRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

export const DEFAULT_DESKTOP_CONFIG = {
  app: { id: 'com.threenative.game', name: 'ThreeNative', version: '0.1.0', build: 1 },
  display: { orientation: 'landscape', fullscreen: true, keepScreenOn: false },
  window: { title: 'ThreeNative', width: 1280, height: 720, resizable: true },
};

function readConfig(configPath) {
  if (configPath === undefined) return DEFAULT_DESKTOP_CONFIG;
  try {
    return JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new Error(`TN_CONFIG_FILE_INVALID: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!['--assets', '--bundle', '--config', '--output', '--runtime'].includes(flag) || !value) {
      throw new Error('Usage: package-desktop.mjs --bundle FILE --runtime FILE --output FILE [--assets DIR] [--config FILE]');
    }
    options[flag.slice(2)] = resolve(value);
  }
  for (const required of ['bundle', 'output', 'runtime']) {
    if (!options[required]) throw new Error(`Missing --${required}.`);
  }
  return options;
}

export function packageDesktop(options) {
  const key = `${process.platform}-${process.arch}`;
  if (!['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64'].includes(key)) {
    throw new Error(`Unsupported desktop platform '${key}'.`);
  }
  for (const [label, file] of [['native bundle', options.bundle], ['prebuilt runtime', options.runtime]]) {
    if (!existsSync(file)) throw new Error(`Missing ${label} for '${key}': ${file}`);
  }
  const output = process.platform === 'win32' && !options.output.endsWith('.exe')
    ? `${options.output}.exe`
    : options.output;
  mkdirSync(dirname(output), { recursive: true });
  const staging = mkdtempSync(join(tmpdir(), 'threenative-desktop-'));
  try {
    const stagedEntry = stageDesktopFiles(
      options.bundle,
      options.assets,
      staging,
      options.config === undefined ? undefined : readConfig(options.config),
    );
    const args = [
      'compile',
      stagedEntry,
      '--root',
      staging,
      '--include',
      staging,
      '--out',
      output,
    ];
    const result = spawnSync(options.runtime, args, { encoding: 'utf8', stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(`Runtime packager exited with code ${result.status ?? 'unknown'}.`);
  } finally {
    rmSync(staging, { force: true, recursive: true });
  }
  if (process.platform !== 'win32') chmodSync(output, 0o755);
  console.log(`ThreeNative desktop artifact: ${output}`);
  return output;
}

export function stageDesktopFiles(
  bundle,
  assets,
  staging,
  config = undefined,
  runtimeSource = runtimeRoot,
) {
  mkdirSync(staging, { recursive: true });
  if (assets && existsSync(assets)) {
    if (!statSync(assets).isDirectory()) {
      throw new Error(`Desktop assets path is not a directory: ${assets}`);
    }
    // Desktop ran no preflight at all, so an asset the runtime cannot decode reached the same
    // rejected `decodeAudioData` that black-screened an APK — with the packager having already
    // read the bytes on its way past. Same gate, desktop's own derived capabilities.
    assertNativeAssetsDecodable(assets, {
      target: 'desktop',
      capabilities: { webp: deriveDesktopWebpSupport(runtimeSource) },
    });
    for (const entry of readdirSync(assets)) {
      if (entry === '.threenative') {
        throw new Error('TN_NATIVE_ASSET_RESERVED_PATH: public/.threenative is reserved.');
      }
      cpSync(join(assets, entry), join(staging, entry), { recursive: true });
    }
  }
  const entry = join(staging, '.threenative', 'game.js');
  mkdirSync(dirname(entry), { recursive: true });
  copyFileSync(bundle, entry);
  if (config !== undefined) {
    const icon = config.app?.icon ?? config.app?.icons?.android?.foreground;
    const packaged = { ...config, app: { ...(config.app ?? {}) } };
    if (icon !== undefined) {
      if (!existsSync(icon) || !statSync(icon).isFile()) {
        throw new Error(`TN_CONFIG_BRAND_DESKTOP_MISSING: app icon does not exist: ${icon}`);
      }
      const stagedIcon = join(staging, '.threenative', 'app-icon.png');
      copyFileSync(icon, stagedIcon);
      packaged.app.icon = '.threenative/app-icon.png';
    }
    writeFileSync(join(staging, '.threenative', 'config.json'), `${JSON.stringify(packaged, null, 2)}\n`);
  }
  return entry;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    packageDesktop(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

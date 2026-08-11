#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
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
import { basename, dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { downloadReleaseArtifact } from './install-prebuilt.mjs';

export const NATIVE_ORIENTATIONS = ['landscape', 'portrait', 'sensor'];
const IOS_ORIENTATIONS = {
  landscape: ['UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight'],
  portrait: ['UIInterfaceOrientationPortrait'],
  sensor: [
    'UIInterfaceOrientationPortrait',
    'UIInterfaceOrientationPortraitUpsideDown',
    'UIInterfaceOrientationLandscapeLeft',
    'UIInterfaceOrientationLandscapeRight',
  ],
};

function orientationValue(value = 'landscape') {
  if (typeof value === 'string' && NATIVE_ORIENTATIONS.includes(value)) return value;
  throw new Error(
    'TN_NATIVE_ORIENTATION_INVALID: threenative.orientation must be landscape, portrait, or sensor.',
  );
}

export function renderIosInfoPlist(source, orientation = 'landscape') {
  const value = orientationValue(orientation);
  const entries = IOS_ORIENTATIONS[value].map((entry) => `    <string>${entry}</string>`).join('\n');
  const key = /(<key>UISupportedInterfaceOrientations<\/key>\s*<array>)[\s\S]*?(<\/array>)/u;
  if (!key.test(source)) {
    throw new Error(
      'TN_IOS_ORIENTATION_KEYS_MISSING: Info.plist has no UISupportedInterfaceOrientations array.',
    );
  }
  return source.replace(key, `$1\n${entries}\n  $2`);
}

function argumentAfter(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1 || !args[index + 1] || args[index + 1].startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return args[index + 1];
}

function valueAfter(args, flag) {
  return resolve(argumentAfter(args, flag));
}

function checksum(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function listFiles(directory, relative = '') {
  const files = [];
  for (const entry of readdirSync(join(directory, relative), { withFileTypes: true })) {
    const path = relative ? posix.join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) files.push(...listFiles(directory, path));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Unsupported iOS asset entry: ${join(directory, path)}`);
  }
  return files.sort();
}

function findApp(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && entry.name.endsWith('.app')) return path;
    if (entry.isDirectory()) {
      const nested = findApp(path);
      if (nested) return nested;
    }
  }
  return undefined;
}

export function stageIosSimulatorApp({ assets, bundle, output, templateApp, orientation = 'landscape' }) {
  const declaredOrientation = orientationValue(orientation);
  for (const [label, path] of [
    ['native bundle', bundle],
    ['verified iOS simulator host', templateApp],
  ]) {
    if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`);
  }
  for (const required of ['Info.plist', 'native-smoke.js', 'threenative-ios']) {
    if (!existsSync(join(templateApp, required))) {
      throw new Error(`Verified iOS simulator host is missing ${required}.`);
    }
  }
  rmSync(output, { force: true, recursive: true });
  mkdirSync(dirname(output), { recursive: true });
  cpSync(templateApp, output, { recursive: true });
  cpSync(bundle, join(output, 'native-smoke.js'));
  const game = join(output, 'game');
  rmSync(game, { force: true, recursive: true });
  mkdirSync(game, { recursive: true });
  const plist = join(output, 'Info.plist');
  writeFileSync(plist, renderIosInfoPlist(readFileSync(plist, 'utf8'), declaredOrientation));
  let assetFiles = [];
  if (assets && existsSync(assets)) {
    if (!statSync(assets).isDirectory()) {
      throw new Error(`iOS assets path is not a directory: ${assets}`);
    }
    assetFiles = listFiles(assets);
    for (const file of assetFiles) {
      const staged = join(game, file);
      mkdirSync(dirname(staged), { recursive: true });
      cpSync(join(assets, file), staged);
    }
  }
  const report = {
    assets: assetFiles.map((path) => ({ path, sha256: checksum(join(game, path)) })),
    bundleSha256: checksum(bundle),
    host: 'ios-simulator-arm64',
    orientation: declaredOrientation,
    output,
    outputBundleSha256: checksum(join(output, 'native-smoke.js')),
  };
  writeFileSync(`${output}.json`, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export async function packageIosSimulator(options) {
  const orientation = orientationValue(options.orientation);
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  if (platform !== 'darwin' || arch !== 'arm64') {
    throw new Error(
      `iOS simulator packaging requires a darwin-arm64 host; received ${platform}-${arch}. Device signing remains OPEN.`,
    );
  }
  const temporary = mkdtempSync(join(tmpdir(), 'threenative-ios-host-'));
  try {
    const suppliedArchive = options.archive ?? process.env.THREENATIVE_IOS_SIMULATOR_ARCHIVE;
    let archive;
    if (suppliedArchive) {
      archive = resolve(suppliedArchive);
      const expected = options.sha256 ?? process.env.THREENATIVE_IOS_SIMULATOR_SHA256 ?? '';
      if (!existsSync(archive) || !/^[a-f0-9]{64}$/u.test(expected)) {
        throw new Error('A local iOS simulator host requires an existing archive and SHA-256.');
      }
      const actual = checksum(archive);
      if (actual !== expected) {
        throw new Error(
          `iOS simulator host checksum mismatch: expected ${expected}, received ${actual}.`,
        );
      }
    } else {
      archive = join(temporary, 'threenative-ios.zip');
      writeFileSync(archive, await downloadReleaseArtifact('ios-simulator-arm64'));
    }
    const result = spawnSync('ditto', ['-x', '-k', archive, temporary], {
      encoding: 'utf8',
      timeout: 120_000,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        `ditto failed to unpack ${basename(archive)}: ${result.stderr || result.stdout}`,
      );
    }
    const templateApp = findApp(temporary);
    if (!templateApp) throw new Error('Verified iOS simulator archive contains no .app bundle.');
    return stageIosSimulatorApp({
      assets: options.assets ? resolve(options.assets) : undefined,
      bundle: resolve(options.bundle),
      output: resolve(options.output),
      templateApp,
      orientation,
    });
  } finally {
    rmSync(temporary, { force: true, recursive: true });
  }
}

export function parseIosPackageArgs(args) {
  return {
    assets: args.includes('--assets') ? valueAfter(args, '--assets') : undefined,
    bundle: valueAfter(args, '--bundle'),
    output: valueAfter(args, '--output'),
    orientation: args.includes('--orientation')
      ? argumentAfter(args, '--orientation')
      : undefined,
  };
}

export async function runIosPackageCli(args, packageSimulator = packageIosSimulator) {
  return packageSimulator({
    archive: process.env.THREENATIVE_IOS_SIMULATOR_ARCHIVE,
    ...parseIosPackageArgs(args),
    sha256: process.env.THREENATIVE_IOS_SIMULATOR_SHA256,
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const report = await runIosPackageCli(process.argv.slice(2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

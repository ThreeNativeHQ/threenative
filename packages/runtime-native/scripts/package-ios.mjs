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
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { downloadReleaseArtifact } from './install-prebuilt.mjs';

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1 || !args[index + 1]) throw new Error(`${flag} requires a value.`);
  return resolve(args[index + 1]);
}

function checksum(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
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

export function stageIosSimulatorApp({ bundle, output, templateApp }) {
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
  const report = {
    bundleSha256: checksum(bundle),
    host: 'ios-simulator-arm64',
    output,
    outputBundleSha256: checksum(join(output, 'native-smoke.js')),
  };
  writeFileSync(`${output}.json`, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export async function packageIosSimulator(options) {
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
        throw new Error(`iOS simulator host checksum mismatch: expected ${expected}, received ${actual}.`);
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
      throw new Error(`ditto failed to unpack ${basename(archive)}: ${result.stderr || result.stdout}`);
    }
    const templateApp = findApp(temporary);
    if (!templateApp) throw new Error('Verified iOS simulator archive contains no .app bundle.');
    return stageIosSimulatorApp({
      bundle: resolve(options.bundle),
      output: resolve(options.output),
      templateApp,
    });
  } finally {
    rmSync(temporary, { force: true, recursive: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const args = process.argv.slice(2);
    const report = await packageIosSimulator({
      archive: process.env.THREENATIVE_IOS_SIMULATOR_ARCHIVE,
      bundle: valueAfter(args, '--bundle'),
      output: valueAfter(args, '--output'),
      sha256: process.env.THREENATIVE_IOS_SIMULATOR_SHA256,
    });
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

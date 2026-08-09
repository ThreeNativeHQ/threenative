#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!['--assets', '--bundle', '--output', '--runtime'].includes(flag) || !value) {
      throw new Error('Usage: package-desktop.mjs --bundle FILE --runtime FILE --output FILE [--assets DIR]');
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
  const args = ['compile', options.bundle, '--out', output];
  if (options.assets && existsSync(options.assets)) args.push('--include', options.assets);
  const result = spawnSync(options.runtime, args, { encoding: 'utf8', stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Runtime packager exited with code ${result.status ?? 'unknown'}.`);
  if (process.platform !== 'win32') chmodSync(output, 0o755);
  console.log(`ThreeNative desktop artifact: ${output}`);
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    packageDesktop(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

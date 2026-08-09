#!/usr/bin/env node

import { existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tools = join(root, '.runtime', 'tools-venv');
const windows = process.platform === 'win32';
const tool = (name) => join(tools, windows ? 'Scripts' : 'bin', `${name}${windows ? '.exe' : ''}`);
const preset = process.platform === 'darwin'
  ? 'tn-macos'
  : process.platform === 'win32'
    ? 'tn-windows'
    : 'tn-linux';

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function available(command) {
  return spawnSync(command, ['--version'], { stdio: 'ignore' }).status === 0;
}

let cmake = 'cmake';
let ninja = 'ninja';
if (!available(cmake) || !available(ninja)) {
  mkdirSync(dirname(tools), { recursive: true });
  const python = windows ? 'python' : 'python3';
  if (!existsSync(tool('python'))) run(python, ['-m', 'venv', tools]);
  run(tool('python'), ['-m', 'pip', 'install', '--disable-pip-version-check', 'cmake', 'ninja']);
  cmake = tool('cmake');
  ninja = tool('ninja');
}

run(cmake, ['--preset', preset, `-DCMAKE_MAKE_PROGRAM=${ninja}`]);
run(cmake, ['--build', '--preset', preset, '--parallel']);

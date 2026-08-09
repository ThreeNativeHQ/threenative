#!/usr/bin/env node

import { existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tools = join(root, '.runtime', 'tools-venv');
const windows = process.platform === 'win32';
const tool = (name) => join(tools, windows ? 'Scripts' : 'bin', `${name}${windows ? '.exe' : ''}`);

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function available(command) {
  return spawnSync(command, ['--version'], { stdio: 'ignore' }).status === 0;
}

let cmake = 'cmake';
if (!available(cmake)) {
  mkdirSync(dirname(tools), { recursive: true });
  if (!existsSync(tool('python'))) run('python3', ['-m', 'venv', tools]);
  run(tool('python'), ['-m', 'pip', 'install', '--disable-pip-version-check', 'cmake', 'ninja']);
  cmake = tool('cmake');
}

run(cmake, ['--preset', 'tn-linux', `-DCMAKE_MAKE_PROGRAM=${tool('ninja')}`]);
run(cmake, ['--build', '--preset', 'tn-linux', '--parallel']);

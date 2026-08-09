#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

export const READY_MARKER = 'TN_NATIVE_SMOKE_READY:webgpu';
export const FIRST_FRAME_MARKER = 'TN_NATIVE_SMOKE_FIRST_FRAME';
const FAILURE_PATTERN = /(?:\bError:|\bRangeError:|validation error|shader parsing error|fatal signal|failed to)/i;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = join(root, '..', '..');

export function analyzeDesktopLog(log, frames = 300) {
  const failures = [];
  if (!log.includes(READY_MARKER)) failures.push(`missing ${READY_MARKER}`);
  if (!log.includes(FIRST_FRAME_MARKER)) failures.push(`missing ${FIRST_FRAME_MARKER}`);
  if (!new RegExp(`Rendered ${frames} frames in \\d+ms`).test(log)) {
    failures.push(`missing exact ${frames}-frame completion`);
  }
  for (const line of log.split(/\r?\n/)) {
    if (FAILURE_PATTERN.test(line)) failures.push(line.trim());
  }
  return [...new Set(failures)];
}

export function inspectScreenshot(path) {
  if (!existsSync(path)) throw new Error(`desktop screenshot is missing: ${path}`);
  const png = PNG.sync.read(readFileSync(path));
  const colors = new Set();
  let opaque = 0;
  for (let index = 0; index < png.data.length; index += 4) {
    const alpha = png.data[index + 3];
    if (alpha !== 0) opaque += 1;
    colors.add(`${png.data[index]},${png.data[index + 1]},${png.data[index + 2]},${alpha}`);
  }
  if (opaque === 0 || colors.size < 2) throw new Error('desktop screenshot is blank');
  return { height: png.height, width: png.width };
}

export function verifyDesktopCore({ frames = 300 } = {}) {
  const binary = join(root, 'build', 'tn-linux', 'mystral');
  const bundle = join(workspace, 'examples', 'native-smoke', 'dist', 'native-smoke.js');
  const date = new Date().toISOString().slice(0, 10);
  const screenshot = join(root, 'artifacts', `desktop-core-${date}.png`);
  for (const [label, path] of [['runtime binary', binary], ['core bundle', bundle]]) {
    if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`);
  }
  mkdirSync(dirname(screenshot), { recursive: true });
  const result = spawnSync(
    'xvfb-run',
    [
      '-a',
      '-s',
      '-screen 0 1600x900x24',
      binary,
      'run',
      bundle,
      '--screenshot',
      screenshot,
      '--frames',
      String(frames),
    ],
    {
      cwd: workspace,
      encoding: 'utf8',
      env: { ...process.env, SDL_VIDEODRIVER: 'x11' },
      timeout: 120_000,
    },
  );
  const log = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`desktop runtime exited ${result.status}:\n${log}`);
  const failures = analyzeDesktopLog(log, frames);
  if (failures.length > 0) throw new Error(`desktop core gate failed:\n${failures.join('\n')}`);
  const image = inspectScreenshot(screenshot);
  return { ...image, frames, log, screenshot };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const result = verifyDesktopCore();
    console.log(
      `desktop core gate passed: ${result.frames} frames, ${result.width}x${result.height}, ${result.screenshot}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

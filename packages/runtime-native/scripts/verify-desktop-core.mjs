#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
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
  // One present per frame. The host used to present inside every `queue.submit`, so a frame that
  // rendered a canvas-layer overlay presented twice and only the first image reached the display —
  // the overlay was dropped on native while working on web. A pixel check alone cannot see this:
  // it reads a screenshot, and a screenshot can be right while the display is wrong.
  const presents = log.match(/^TN_PRESENTS:(\d+)$/mu);
  if (!presents) failures.push('missing TN_PRESENTS count');
  else if (Number(presents[1]) !== frames) {
    failures.push(
      `presented ${presents[1]} times for ${frames} frames; expected exactly one present per frame`,
    );
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

/**
 * Asserts the canvas-layer overlay reached the screen.
 *
 * The overlay is a second `renderer.render()` in the same frame. The native host used to present
 * inside every `queue.submit`, so that second pass acquired its own swapchain image and only the
 * first present of the frame was displayed — every overlay was silently dropped on native while
 * working on web. A blank-screenshot check cannot see that: the world still renders. This looks
 * for the overlay's own colour, which nothing in the world draws.
 */
export function inspectOverlay(path, { color = 0xff00ff, minPixels = 256 } = {}) {
  const png = PNG.sync.read(readFileSync(path));
  const red = (color >> 16) & 0xff;
  const green = (color >> 8) & 0xff;
  const blue = color & 0xff;
  let matched = 0;
  for (let index = 0; index < png.data.length; index += 4) {
    // Exact match: the overlay is unlit MeshBasicMaterial, so the host must reproduce it exactly.
    if (png.data[index] === red && png.data[index + 1] === green && png.data[index + 2] === blue) {
      matched += 1;
    }
  }
  if (matched < minPixels) {
    throw new Error(
      `canvas-layer overlay missing from ${path}: found ${matched} pixels of #${color.toString(16).padStart(6, '0')}, expected at least ${minPixels}. ` +
      'The overlay pass rendered but never reached the display.',
    );
  }
  return { overlayPixels: matched };
}

export function verifyDesktopCore({ frames = 300 } = {}) {
  const preset = process.platform === 'darwin'
    ? 'tn-macos'
    : process.platform === 'win32'
      ? 'tn-windows'
      : 'tn-linux';
  const binary = join(root, 'build', preset, process.platform === 'win32' ? 'mystral.exe' : 'mystral');
  const bundle = join(workspace, 'examples', 'native-smoke', 'dist', 'native-smoke.js');
  const date = new Date().toISOString().slice(0, 10);
  const screenshot = join(root, 'artifacts', `desktop-core-${date}.png`);
  const logPath = join(root, 'artifacts', `desktop-${process.platform}.log`);
  const reportPath = join(root, 'artifacts', `desktop-${process.platform}-report.json`);
  for (const [label, path] of [['runtime binary', binary], ['core bundle', bundle]]) {
    if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`);
  }
  mkdirSync(dirname(screenshot), { recursive: true });
  const runtimeArgs = [
    'run',
    bundle,
    '--screenshot',
    screenshot,
    '--frames',
    String(frames),
  ];
  // Not `xvfb-run`: on xorg-server-xvfb 21.1.24 its cleanup `kill` fails after Xvfb has already
  // exited and that failing kill's status replaces the command's, so this gate reported a red
  // 300-frame run that had in fact rendered every frame and written a good screenshot.
  const command = process.platform === 'linux' ? 'sh' : binary;
  const args = process.platform === 'linux'
    ? [join(workspace, 'scripts', 'xvfb.sh'), binary, ...runtimeArgs]
    : runtimeArgs;
  const runtimeEnv = { ...process.env };
  if (process.platform === 'linux') runtimeEnv.SDL_VIDEODRIVER = 'x11';
  const result = spawnSync(
    command,
    args,
    {
      cwd: workspace,
      encoding: 'utf8',
      env: runtimeEnv,
      timeout: 120_000,
    },
  );
  const log = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`desktop runtime exited ${result.status}:\n${log}`);
  const failures = analyzeDesktopLog(log, frames);
  if (failures.length > 0) throw new Error(`desktop core gate failed:\n${failures.join('\n')}`);
  const image = inspectScreenshot(screenshot);
  const overlay = inspectOverlay(screenshot);
  const report = {
    completedAt: new Date().toISOString(),
    frames,
    host: { arch: process.arch, platform: process.platform },
    log: relative(workspace, logPath),
    markers: [READY_MARKER, FIRST_FRAME_MARKER, `Rendered ${frames} frames`],
    pass: true,
    preset,
    screenshot: {
      ...image,
      ...overlay,
      path: relative(workspace, screenshot),
      sha256: createHash('sha256').update(readFileSync(screenshot)).digest('hex'),
    },
  };
  writeFileSync(logPath, log);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { ...image, ...overlay, frames, host: process.platform, log, preset, reportPath, screenshot };
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

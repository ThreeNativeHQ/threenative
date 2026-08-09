#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';

const READY_MARKER = 'TN_NATIVE_SMOKE_READY:webgpu';
const ASSET_MARKER = 'TN_NATIVE_STARTER_ASSETS_LOADED:texture,glb';

export function inspectStarterScreenshot(path) {
  if (!existsSync(path)) throw new Error(`TN_NATIVE_STARTER_SCREENSHOT_MISSING: ${path}`);
  const png = PNG.sync.read(readFileSync(path));
  const colors = new Set();
  let cyanAssetPixels = 0;
  for (let index = 0; index < png.data.length; index += 4) {
    const red = png.data[index];
    const green = png.data[index + 1];
    const blue = png.data[index + 2];
    const alpha = png.data[index + 3];
    colors.add(`${red},${green},${blue},${alpha}`);
    if (alpha > 0 && blue > 150 && green > 140 && blue > red * 1.4) cyanAssetPixels += 1;
  }
  if (colors.size < 2) throw new Error('TN_NATIVE_STARTER_SCREENSHOT_BLANK: one-color frame.');
  if (cyanAssetPixels < 100) {
    throw new Error(`TN_NATIVE_STARTER_ASSET_NOT_VISIBLE: found ${cyanAssetPixels} cyan proof pixels.`);
  }
  return { colors: colors.size, cyanAssetPixels, height: png.height, width: png.width };
}

export function analyzeStarterLog(log, frames = 300) {
  const failures = [];
  for (const marker of [READY_MARKER, ASSET_MARKER, `TN_NATIVE_SMOKE_${frames}_FRAMES:${frames}`]) {
    if (!log.includes(marker)) failures.push(`missing ${marker}`);
  }
  if (!new RegExp(`Rendered ${frames} frames in \\d+ms`, 'u').test(log)) {
    failures.push(`missing exact ${frames}-frame completion`);
  }
  for (const pattern of [/TN_NATIVE_START_FAILED/u, /validation error/iu, /TypeError:/u]) {
    if (pattern.test(log)) failures.push(`runtime log matched ${pattern}`);
  }
  return failures;
}

export function verifyStarterDesktop({ frames = 300, project = process.cwd() } = {}) {
  const projectRoot = resolve(project);
  const manifest = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
  const projectName = basename(String(manifest.name ?? 'starter').replace(/^@[^/]+\//u, ''));
  const executableName = process.platform === 'win32' ? `${projectName}.exe` : projectName;
  const artifact = join(projectRoot, 'dist-native', executableName);
  if (!existsSync(artifact)) {
    throw new Error(`TN_NATIVE_STARTER_ARTIFACT_MISSING: run pnpm build:desktop first (${artifact}).`);
  }
  const artifactDirectory = join(projectRoot, 'artifacts', 'native');
  const screenshot = join(artifactDirectory, 'starter-desktop.png');
  const logPath = join(artifactDirectory, 'starter-desktop.log');
  const reportPath = join(artifactDirectory, 'starter-desktop-report.json');
  mkdirSync(artifactDirectory, { recursive: true });
  const runtimeArgs = ['--screenshot', screenshot, '--frames', String(frames)];
  const command = process.platform === 'linux' ? 'xvfb-run' : artifact;
  const args = process.platform === 'linux'
    ? ['-a', '-s', '-screen 0 1600x900x24', artifact, ...runtimeArgs]
    : runtimeArgs;
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    env: process.platform === 'linux' ? { ...process.env, SDL_VIDEODRIVER: 'x11' } : process.env,
    timeout: 120_000,
  });
  if (result.error) throw result.error;
  const log = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  writeFileSync(logPath, log);
  if (result.status !== 0) throw new Error(`TN_NATIVE_STARTER_EXIT_${result.status}:\n${log}`);
  const failures = analyzeStarterLog(log, frames);
  if (failures.length > 0) throw new Error(`TN_NATIVE_STARTER_LOG_FAILED:\n${failures.join('\n')}`);
  const image = inspectStarterScreenshot(screenshot);
  const report = {
    artifact,
    completedAt: new Date().toISOString(),
    frames,
    image,
    log: logPath,
    pass: true,
    screenshot,
    screenshotSha256: createHash('sha256').update(readFileSync(screenshot)).digest('hex'),
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const report = verifyStarterDesktop();
    console.log(`starter desktop gate passed: ${report.frames} frames, ${report.image.colors} colors, ${report.image.cyanAssetPixels} asset pixels`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

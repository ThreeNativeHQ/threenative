#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';

const READY_MARKER = 'TN_NATIVE_SMOKE_READY:webgpu';
const ASSET_MARKER = 'TN_NATIVE_STARTER_ASSETS_LOADED:texture,glb';
// Measured: a drawn starter frame has ~17,000 distinct colours, a lost capture had 5.
const UNRENDERED_FRAME_COLOR_FLOOR = 64;
// 64x64. Below this the frame is a fixture, not a capture.
const UNRENDERED_FRAME_MIN_PIXELS = 4096;
const ASSET_PIXEL_FLOOR = 100;
const PROOF_COLOR_MAX_DISTANCE = 180;
const CHECKERBOARD_CELLS = 4;
const CHECKERBOARD_MIN_SUPPORTED_CELLS = 8;
const CHECKERBOARD_MIN_MATCH_RATIO = 0.75;
const CHECKERBOARD_MIN_CELL_COVERAGE = 0.08;
const CHECKERBOARD_MIN_TRANSITIONS = 2;
const CHECKERBOARD_MAX_UNKNOWN_GAP = 2;
// The packaged 16x16 proof has four alternating 4x4 blocks in each axis.
const PROOF_CYAN = [18, 220, 255];
const PROOF_MAGENTA = [255, 40, 180];
// A proof region may occupy up to a quarter of a rendered frame; a wash that reaches almost every
// part of the frame must not count as localized evidence.
const MAX_ASSET_BOUNDS_FRACTION = 0.25;

function colorDistanceSquared(data, offset, color) {
  const red = data[offset] - color[0];
  const green = data[offset + 1] - color[1];
  const blue = data[offset + 2] - color[2];
  return red * red + green * green + blue * blue;
}

function classifyProofPixel(data, offset) {
  if (data[offset + 3] === 0) return 0;
  const cyanDistance = colorDistanceSquared(data, offset, PROOF_CYAN);
  const magentaDistance = colorDistanceSquared(data, offset, PROOF_MAGENTA);
  if (Math.min(cyanDistance, magentaDistance) > PROOF_COLOR_MAX_DISTANCE ** 2) return 0;
  return cyanDistance <= magentaDistance ? 1 : 2;
}

function enqueueProofNeighbor(presence, queue, tail, neighbor) {
  if (presence[neighbor] === 0) return tail;
  presence[neighbor] = 0;
  queue[tail] = neighbor;
  return tail + 1;
}

function enqueueProofNeighbors(presence, queue, tail, width, height, index) {
  const x = index % width;
  const y = Math.floor(index / width);
  let nextTail = tail;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const neighborX = x + dx;
      const neighborY = y + dy;
      if (neighborX < 0 || neighborX >= width || neighborY < 0 || neighborY >= height) continue;
      nextTail = enqueueProofNeighbor(presence, queue, nextTail, neighborY * width + neighborX);
    }
  }
  return nextTail;
}

function measureProofRegion(classes, presence, queue, width, height, start) {
  let head = 0;
  let tail = 1;
  let cyanPixels = 0;
  let magentaPixels = 0;
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;
  queue[0] = start;
  presence[start] = 0;
  while (head < tail) {
    const index = queue[head];
    head += 1;
    const proofClass = classes[index];
    if (proofClass !== 0) {
      if (proofClass === 1) cyanPixels += 1;
      else magentaPixels += 1;
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    tail = enqueueProofNeighbors(presence, queue, tail, width, height, index);
  }
  return { cyanPixels, magentaPixels, maxX, maxY, minX, minY };
}

function countCheckerboardCell(classes, width, startX, endX, startY, endY) {
  let observed = 0;
  let cyan = 0;
  let magenta = 0;
  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const proofClass = classes[y * width + x];
      if (proofClass === 0) continue;
      observed += 1;
      if (proofClass === 1) cyan += 1;
      else magenta += 1;
    }
  }
  return { cyan, magenta, observed };
}

function isSupportedCheckerboardCell(cell, cellArea) {
  return cell.observed >= Math.max(2, Math.ceil(cellArea * CHECKERBOARD_MIN_CELL_COVERAGE));
}

function matchesCheckerboardCell(cell, cellX, cellY, phase) {
  const expectedIsCyan = (cellX + cellY + phase) % 2 !== 0;
  const expectedPixels = expectedIsCyan ? cell.cyan : cell.magenta;
  const otherPixels = expectedIsCyan ? cell.magenta : cell.cyan;
  return expectedPixels >= otherPixels && expectedPixels / cell.observed >= 0.55;
}

function checkerboardCellMatch(classes, width, region, phase) {
  const regionWidth = region.maxX - region.minX + 1;
  const regionHeight = region.maxY - region.minY + 1;
  let supportedCells = 0;
  let matchingCells = 0;
  for (let cellY = 0; cellY < CHECKERBOARD_CELLS; cellY += 1) {
    const startY = region.minY + Math.floor((cellY * regionHeight) / CHECKERBOARD_CELLS);
    const endY = region.minY + Math.floor(((cellY + 1) * regionHeight) / CHECKERBOARD_CELLS);
    for (let cellX = 0; cellX < CHECKERBOARD_CELLS; cellX += 1) {
      const startX = region.minX + Math.floor((cellX * regionWidth) / CHECKERBOARD_CELLS);
      const endX = region.minX + Math.floor(((cellX + 1) * regionWidth) / CHECKERBOARD_CELLS);
      const cell = countCheckerboardCell(classes, width, startX, endX, startY, endY);
      const cellArea = (endX - startX) * (endY - startY);
      if (!isSupportedCheckerboardCell(cell, cellArea)) continue;
      supportedCells += 1;
      if (matchesCheckerboardCell(cell, cellX, cellY, phase)) matchingCells += 1;
    }
  }
  return { matchingCells, supportedCells };
}

function countAlternatingTransitions(classes, startIndex, length, stride) {
  let observed = 0;
  let transitions = 0;
  let previousClass = 0;
  let unknownGap = 0;
  for (let offset = 0; offset < length; offset += 1) {
    const proofClass = classes[startIndex + offset * stride];
    if (proofClass === 0) {
      if (previousClass !== 0) unknownGap += 1;
      continue;
    }
    observed += 1;
    if (previousClass !== 0) {
      if (unknownGap <= CHECKERBOARD_MAX_UNKNOWN_GAP && proofClass !== previousClass) {
        transitions += 1;
      } else if (unknownGap > CHECKERBOARD_MAX_UNKNOWN_GAP) {
        previousClass = 0;
      }
    }
    previousClass = proofClass;
    unknownGap = 0;
  }
  return { observed, transitions };
}

function countQualifiedScanlines(classes, width, region, horizontal) {
  const lineCount = horizontal ? region.maxY - region.minY + 1 : region.maxX - region.minX + 1;
  const lineLength = horizontal ? region.maxX - region.minX + 1 : region.maxY - region.minY + 1;
  const minimumObserved = Math.max(4, Math.ceil(lineLength * 0.2));
  const stride = horizontal ? 1 : width;
  let qualified = 0;
  for (let line = 0; line < lineCount; line += 1) {
    const startIndex = horizontal
      ? (region.minY + line) * width + region.minX
      : region.minY * width + region.minX + line;
    const stats = countAlternatingTransitions(classes, startIndex, lineLength, stride);
    if (stats.observed >= minimumObserved && stats.transitions >= CHECKERBOARD_MIN_TRANSITIONS) {
      qualified += 1;
    }
  }
  return qualified;
}

function hasCheckerboardScanlineEvidence(classes, width, region) {
  const horizontal = countQualifiedScanlines(classes, width, region, true);
  const vertical = countQualifiedScanlines(classes, width, region, false);
  const minimumHorizontal = Math.max(4, Math.ceil((region.maxY - region.minY + 1) * 0.2));
  const minimumVertical = Math.max(4, Math.ceil((region.maxX - region.minX + 1) * 0.2));
  return horizontal >= minimumHorizontal && vertical >= minimumVertical;
}

function isCheckerboardRegion(classes, width, height, region, rendered) {
  const cyanPixels = region.cyanPixels;
  const magentaPixels = region.magentaPixels;
  if (cyanPixels < ASSET_PIXEL_FLOOR || magentaPixels < ASSET_PIXEL_FLOOR / 4) return false;
  const regionWidth = region.maxX - region.minX + 1;
  const regionHeight = region.maxY - region.minY + 1;
  if (regionWidth < CHECKERBOARD_CELLS || regionHeight < CHECKERBOARD_CELLS) return false;
  if (
    rendered &&
    regionWidth * regionHeight > width * height * MAX_ASSET_BOUNDS_FRACTION
  )
    return false;
  let bestMatch = { matchingCells: 0, supportedCells: 0 };
  for (let phase = 0; phase < 2; phase += 1) {
    const match = checkerboardCellMatch(classes, width, region, phase);
    if (match.matchingCells > bestMatch.matchingCells) bestMatch = match;
  }
  const cellEvidence =
    bestMatch.supportedCells >= CHECKERBOARD_MIN_SUPPORTED_CELLS &&
    bestMatch.matchingCells / bestMatch.supportedCells >= CHECKERBOARD_MIN_MATCH_RATIO;
  return cellEvidence || hasCheckerboardScanlineEvidence(classes, width, region);
}

function markProofNeighborhood(presence, width, height, index) {
  const x = index % width;
  const y = Math.floor(index / width);
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const neighborX = x + dx;
      const neighborY = y + dy;
      if (neighborX >= 0 && neighborX < width && neighborY >= 0 && neighborY < height) {
        presence[neighborY * width + neighborX] = 1;
      }
    }
  }
}

function hasCheckerboardProof(classes, width, height, rendered) {
  const presence = new Uint8Array(classes.length);
  for (let index = 0; index < classes.length; index += 1) {
    if (classes[index] === 0) continue;
    markProofNeighborhood(presence, width, height, index);
  }
  const queue = new Uint32Array(classes.length);
  for (let start = 0; start < presence.length; start += 1) {
    if (presence[start] === 0) continue;
    const region = measureProofRegion(classes, presence, queue, width, height, start);
    if (isCheckerboardRegion(classes, width, height, region, rendered)) return true;
  }
  return false;
}

export function inspectStarterScreenshot(path) {
  if (!existsSync(path)) throw new Error(`TN_NATIVE_STARTER_SCREENSHOT_MISSING: ${path}`);
  const png = PNG.sync.read(readFileSync(path));
  const colors = new Set();
  const proofClasses = new Uint8Array(png.width * png.height);
  let cyanAssetPixels = 0;
  for (let index = 0; index < png.data.length; index += 4) {
    const red = png.data[index];
    const green = png.data[index + 1];
    const blue = png.data[index + 2];
    const alpha = png.data[index + 3];
    colors.add(`${red},${green},${blue},${alpha}`);
    const proofClass = classifyProofPixel(png.data, index);
    proofClasses[index / 4] = proofClass;
    if (proofClass === 1) {
      cyanAssetPixels += 1;
    }
  }
  if (colors.size < 2) throw new Error('TN_NATIVE_STARTER_SCREENSHOT_BLANK: one-color frame.');
  // A one-colour guard is too weak to catch the capture this gate actually loses. A rendered
  // starter frame carries roughly 17k distinct colours; an intermittent CI failure captured five —
  // flat background, two flat shapes, thirteen pixels of the GLB — while the run log still showed
  // TN_NATIVE_STARTER_ASSETS_LOADED and "Rendered 300 frames". That frame was never drawn, and
  // reporting it as a missing asset sends the reader hunting for a texture that loaded fine.
  // Only meaningful at capture resolution. A 16x16 synthetic fixture — what the installed-verifier
  // distribution test feeds this function — is legitimately two colours, and judging it by the
  // diversity a 1280x720 render carries would reject a frame that is exactly what it claims to be.
  const rendered = png.width * png.height >= UNRENDERED_FRAME_MIN_PIXELS;
  if (rendered && colors.size < UNRENDERED_FRAME_COLOR_FLOOR) {
    throw new Error(
        `TN_NATIVE_STARTER_FRAME_NOT_RENDERED: only ${colors.size} distinct colours in ${png.width}x${png.height}. The run log may still show every marker: this is the capture, not the scene.`,
    );
  }
  const hasAssetEvidence =
    cyanAssetPixels >= ASSET_PIXEL_FLOOR &&
    hasCheckerboardProof(proofClasses, png.width, png.height, rendered);
  if (!hasAssetEvidence) {
    throw new Error(`TN_NATIVE_STARTER_ASSET_NOT_VISIBLE: checkerboard proof was not identified; found ${cyanAssetPixels} cyan proof pixels in a frame of ${colors.size} colours.`);
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
  // The capture is only evidence if the world was on screen when it was taken. The host holds the
  // screenshot until the startup gate opens and says so; a 0 here means it captured the loading
  // state after waiting out its budget, which is the difference between a 17,000-colour frame and
  // a five-colour one.
  if (log.includes('TN_STARTUP_CAPTURE_READY:0')) {
    failures.push('startup gate never opened before capture (TN_STARTUP_CAPTURE_READY:0)');
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
  // See verify-desktop-core.mjs: `xvfb-run` hands back its own failing cleanup kill's status.
  const displayHelper = join(dirname(fileURLToPath(import.meta.url)), 'xvfb.sh');
  if (process.platform === 'linux' && !existsSync(displayHelper)) {
    throw new Error(`TN_NATIVE_STARTER_DISPLAY_SUPPORT_MISSING: ${displayHelper}`);
  }
  const command = process.platform === 'linux' ? 'sh' : artifact;
  const args = process.platform === 'linux'
    ? [displayHelper, artifact, ...runtimeArgs]
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

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    const report = verifyStarterDesktop();
    console.log(`starter desktop gate passed: ${report.frames} frames, ${report.image.colors} colors, ${report.image.cyanAssetPixels} asset pixels`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

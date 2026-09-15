#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { release as osRelease } from 'node:os';
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
// The packaged proof is a cyan/magenta checkerboard pennant, and it is identified by CHANNEL
// MARGIN rather than by distance to the authored texture colour. The gate reads a lit, tonemapped
// render, and the authored cyan never reaches the screen: measured on the CI capture of run
// 34076016432, the pennant's cyan renders as rgb(86,180,189) — 103 away from the authored
// [18,220,255] — while the ocean behind it sits at 149 and the sky at 140. Any absolute-distance
// threshold wide enough to admit the asset also admits the sea, which is how a frame showing the
// pennant plainly was rejected with 798,464 of 921,600 pixels classified as proof.
//
// Magenta is the discriminator, because an ocean world contains none: 521 magenta pixels on the
// pennant, against 0 in the same frame with the pennant cropped away.
const PROOF_MAGENTA_MIN_MARGIN = 40;
// Corroborating cyan, counted only inside the magenta bounds so the background cannot supply it.
const PROOF_CYAN_MIN_MARGIN = 70;
const PROOF_CYAN_IN_BOUNDS_FLOOR = 50;
// A proof region may occupy up to a quarter of a rendered frame; a wash that reaches almost every
// part of the frame must not count as localized evidence.
const MAX_ASSET_BOUNDS_FRACTION = 0.25;
// Bounds alone cannot separate a small asset from magenta scattered thinly across the frame, since
// scattered pixels share almost the same bounding box as a solid one. Density does: the pennant
// fills 0.236 of its own bounds, scattered noise fills 0.04.
const MIN_ASSET_BOUNDS_DENSITY = 0.1;

function isProofMagenta(data, offset) {
  return (
    data[offset + 3] > 0 &&
    data[offset] > data[offset + 1] + PROOF_MAGENTA_MIN_MARGIN &&
    data[offset + 2] > data[offset + 1] + PROOF_MAGENTA_MIN_MARGIN
  );
}

function isProofCyan(data, offset) {
  return (
    data[offset + 3] > 0 &&
    data[offset + 1] - data[offset] > PROOF_CYAN_MIN_MARGIN &&
    data[offset + 2] - data[offset] > PROOF_CYAN_MIN_MARGIN
  );
}

function countProofCyanInBounds(png, bounds) {
  let cyan = 0;
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      if (isProofCyan(png.data, (y * png.width + x) * 4)) cyan += 1;
    }
  }
  return cyan;
}

// Localization is a question about a capture, not about a texture, so only a capture-sized frame
// reaches this. The distribution test feeds the packaged 16x16 proof itself, where the asset
// legitimately fills the whole frame and asking where it sits has no meaning.
function assertProofIsLocalized(png, bounds, magentaAssetPixels) {
  const boundsArea = (bounds.maxX - bounds.minX + 1) * (bounds.maxY - bounds.minY + 1);
  const boundsFraction = boundsArea / (png.width * png.height);
  if (boundsFraction > MAX_ASSET_BOUNDS_FRACTION) {
    throw new Error(
      `TN_NATIVE_STARTER_ASSET_NOT_LOCALIZED: magenta spans ${(boundsFraction * 100).toFixed(1)}% of the frame, which is a wash, not the proof asset.`,
    );
  }
  const density = magentaAssetPixels / boundsArea;
  if (density < MIN_ASSET_BOUNDS_DENSITY) {
    throw new Error(
      `TN_NATIVE_STARTER_ASSET_NOT_LOCALIZED: magenta fills only ${(density * 100).toFixed(1)}% of its own bounds, which is scatter, not the proof asset.`,
    );
  }
}

// One pass over the frame: the colour census the unrendered-frame floor reads, and the magenta
// pixel count with the bounds it occupies.
function scanProofMagenta(png) {
  const colors = new Set();
  const bounds = { maxX: -1, maxY: -1, minX: png.width, minY: png.height };
  let magentaAssetPixels = 0;
  for (let index = 0; index < png.data.length; index += 4) {
    colors.add(
      `${png.data[index]},${png.data[index + 1]},${png.data[index + 2]},${png.data[index + 3]}`,
    );
    if (!isProofMagenta(png.data, index)) continue;
    magentaAssetPixels += 1;
    const pixel = index / 4;
    const x = pixel % png.width;
    const y = Math.floor(pixel / png.width);
    if (x < bounds.minX) bounds.minX = x;
    if (x > bounds.maxX) bounds.maxX = x;
    if (y < bounds.minY) bounds.minY = y;
    if (y > bounds.maxY) bounds.maxY = y;
  }
  return { bounds, colors, magentaAssetPixels };
}

export function inspectStarterScreenshot(path) {
  if (!existsSync(path)) throw new Error(`TN_NATIVE_STARTER_SCREENSHOT_MISSING: ${path}`);
  const png = PNG.sync.read(readFileSync(path));
  const { bounds, colors, magentaAssetPixels } = scanProofMagenta(png);
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
  if (magentaAssetPixels < ASSET_PIXEL_FLOOR) {
    throw new Error(
      `TN_NATIVE_STARTER_ASSET_NOT_VISIBLE: found ${magentaAssetPixels} magenta proof pixels in a frame of ${colors.size} colours.`,
    );
  }
  if (rendered) assertProofIsLocalized(png, bounds, magentaAssetPixels);
  const cyanAssetPixels = countProofCyanInBounds(png, bounds);
  if (cyanAssetPixels < PROOF_CYAN_IN_BOUNDS_FLOOR) {
    throw new Error(
      `TN_NATIVE_STARTER_ASSET_NOT_VISIBLE: magenta found but only ${cyanAssetPixels} cyan proof pixels inside its bounds; the checkerboard needs both colours.`,
    );
  }
  return {
    colors: colors.size,
    cyanAssetPixels,
    height: png.height,
    magentaAssetPixels,
    width: png.width,
  };
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
  // Windowed at the configured size, not the starter's `display.fullscreen: true` default: a
  // headless Windows runner has no interactive desktop for a fullscreen swap and the process was
  // seen to hang in it, and a fixed window keeps the capture size the render gates already assert.
  const runtimeArgs = ['--windowed', '--screenshot', screenshot, '--frames', String(frames)];
  // See verify-desktop-core.mjs: `xvfb-run` hands back its own failing cleanup kill's status.
  const displayHelper = join(dirname(fileURLToPath(import.meta.url)), 'xvfb.sh');
  if (process.platform === 'linux' && !existsSync(displayHelper)) {
    throw new Error(`TN_NATIVE_STARTER_DISPLAY_SUPPORT_MISSING: ${displayHelper}`);
  }
  const command = process.platform === 'linux' ? 'sh' : artifact;
  const args = process.platform === 'linux'
    ? [displayHelper, artifact, ...runtimeArgs]
    : runtimeArgs;
  // A hosted Windows runner renders 300 frames on a software adapter with the WebView2 overlay
  // compositing alongside, which is slower than the Linux and macOS lanes; the override keeps a
  // genuinely hung run bounded at the caller's number instead of ours.
  const timeoutMs = Number(process.env.TN_STARTER_TIMEOUT_MS ?? 300_000);
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    env: process.platform === 'linux' ? { ...process.env, SDL_VIDEODRIVER: 'x11' } : process.env,
    timeout: timeoutMs,
  });
  // Write the captured output before judging it. On a timeout `spawnSync` sets `error` and the old
  // code threw before the log existed, so a Windows run that hung reported only ETIMEDOUT and no
  // clue where it stopped; the log is the diagnosis.
  const log = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  writeFileSync(logPath, log);
  if (result.error) {
    throw new Error(`TN_NATIVE_STARTER_SPAWN_FAILED: ${result.error.message}\n${log}`);
  }
  if (result.status !== 0) throw new Error(`TN_NATIVE_STARTER_EXIT_${result.status}:\n${log}`);
  const failures = analyzeStarterLog(log, frames);
  if (failures.length > 0) throw new Error(`TN_NATIVE_STARTER_LOG_FAILED:\n${failures.join('\n')}`);
  // Windows (DWM) and macOS (Quartz) always composite, so the default starter's WebView HUD must
  // attach there. Linux CI runs a bare Xvfb with no compositor and the overlay correctly refuses,
  // so this is asserted only where the desktop compositor is part of the OS.
  const overlayAttached = log.includes('"attached":true');
  if ((process.platform === 'win32' || process.platform === 'darwin') && !overlayAttached) {
    throw new Error(
      'TN_NATIVE_STARTER_UI_OVERLAY_MISSING: the starter WebView HUD did not attach on this always-composited desktop host.',
    );
  }
  const image = inspectStarterScreenshot(screenshot);
  const report = {
    artifact,
    completedAt: new Date().toISOString(),
    frames,
    image,
    log: logPath,
    overlayAttached,
    pass: true,
    screenshot,
    screenshotSha256: createHash('sha256').update(readFileSync(screenshot)).digest('hex'),
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

/**
 * PRD-366 phase 2 — the distributed consumer gameplay row.
 *
 * Phase 1 proved the *installed* starter plays in a browser after a game-only edit. Phase 2 asks
 * the same question of each claimed native target and records a row that names the machine it ran
 * on, the artifact it ran and the application identity it carried — never a hardcoded pass. A run
 * that evaluated no assertions, a row missing for a required target, or an artifact/application id
 * that is not the built consumer all fail closed with the actual cause named.
 */
export const CONSUMER_GAMEPLAY_SCENARIO = 'playtests/production-readiness.playtest.json';
export const CONSUMER_REQUIRED_TARGETS = ['desktop', 'android'];
const CONSUMER_ARTIFACT_HASH = /^[0-9a-f]{64}$/u;

function consumerError(code, detail) {
  return new Error(`TN_STARTER_CONSUMER_${code}: ${detail}`);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/** The session the run executed in, named rather than assumed: a headless Linux host is not X11. */
export function describeConsumerSession(platform = process.platform, environment = process.env) {
  if (platform === 'android') return 'android';
  if (platform === 'win32') return 'windows-dwm';
  if (platform === 'darwin') return 'quartz';
  if (platform === 'linux') {
    if (environment.WAYLAND_DISPLAY) return 'wayland';
    if (environment.DISPLAY) return 'x11';
    return 'headless';
  }
  return platform;
}

/** Fail closed on a row that is structurally unreadable, before any value comparison. */
export function validateConsumerTargetRow(row) {
  if (typeof row !== 'object' || row === null || Array.isArray(row))
    throw consumerError('ROW_MALFORMED', 'a target row must be an object.');
  for (const field of [
    'target',
    'os',
    'osVersion',
    'architecture',
    'session',
    'scenario',
    'applicationId',
    'artifactHash',
  ]) {
    if (!nonEmptyString(row[field]))
      throw consumerError('ROW_MALFORMED', `target row field '${field}' is missing or empty.`);
  }
  if (!CONSUMER_ARTIFACT_HASH.test(row.artifactHash))
    throw consumerError(
      'ROW_MALFORMED',
      `artifactHash '${row.artifactHash}' is not a sha256 hex digest.`,
    );
  if (typeof row.pass !== 'boolean')
    throw consumerError('ROW_MALFORMED', "target row field 'pass' is not a boolean.");
  if (!Number.isInteger(row.assertions) || row.assertions < 0)
    throw consumerError(
      'ROW_MALFORMED',
      "target row field 'assertions' is not a non-negative integer.",
    );
  if (!Array.isArray(row.failures))
    throw consumerError('ROW_MALFORMED', "target row field 'failures' is not an array.");
  return row;
}

/**
 * Compare one recorded row against the built consumer's own identity. Each divergence names its
 * cause: a foreign scenario is a substituted subject, a hash that disagrees is a stale or swapped
 * artifact, and an application id that disagrees is a different game.
 */
export function qualifyConsumerTargetRow(row, expected) {
  validateConsumerTargetRow(row);
  if (
    !nonEmptyString(expected?.scenario) ||
    !nonEmptyString(expected?.applicationId) ||
    !CONSUMER_ARTIFACT_HASH.test(expected?.artifactHash ?? '')
  )
    throw consumerError('ROW_MALFORMED', 'the expected consumer identity is incomplete.');
  if (row.scenario !== expected.scenario)
    throw consumerError(
      'SCENARIO_MISMATCH',
      `the '${row.target}' row ran '${row.scenario}', not the built consumer's '${expected.scenario}'; a substituted native-smoke subject is not this consumer.`,
    );
  if (row.artifactHash !== expected.artifactHash)
    throw consumerError(
      'ARTIFACT_MISMATCH',
      `the '${row.target}' row's artifact ${row.artifactHash.slice(0, 12)} does not match the built consumer ${expected.artifactHash.slice(0, 12)}; a stale or substituted build is not this consumer.`,
    );
  if (row.applicationId !== expected.applicationId)
    throw consumerError(
      'APPLICATION_ID_MISMATCH',
      `the '${row.target}' row's applicationId '${row.applicationId}' does not match the built consumer '${expected.applicationId}'.`,
    );
  if (row.assertions === 0)
    throw consumerError(
      'NO_ASSERTIONS',
      `the '${row.target}' run evaluated zero assertions, so a pass would prove nothing.`,
    );
  if (row.pass !== true)
    throw consumerError(
      'ASSERTION_FAILED',
      `the '${row.target}' consumer run failed: ${row.failures.join('; ') || 'assertions did not pass'}.`,
    );
  return row;
}

/** Every claimed target must carry its own qualified row; a missing target is not an empty check. */
export function assertConsumerTargetRows(rows, options) {
  const targets = options?.targets ?? CONSUMER_REQUIRED_TARGETS;
  if (!Array.isArray(rows) || !Array.isArray(targets) || targets.length === 0)
    throw consumerError('ROW_MALFORMED', 'consumer rows and required targets must be non-empty.');
  const validated = rows.map(validateConsumerTargetRow);
  const qualified = [];
  for (const target of targets) {
    const row = validated.find((candidate) => candidate.target === target);
    if (row === undefined)
      throw consumerError(
        'ROW_MISSING',
        `no consumer gameplay row was recorded for target '${target}'.`,
      );
    qualified.push(qualifyConsumerTargetRow(row, options));
  }
  return qualified;
}

/** Read the JSON report the installed runner prints; a report with no assertions is a failure. */
export function parseConsumerPlaytestReport(stdout, target) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw consumerError(
      'ROW_MALFORMED',
      `the '${target}' playtest runner emitted no JSON report: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw consumerError('ROW_MALFORMED', `the '${target}' playtest report is not an object.`);
  const diagnostics = Array.isArray(parsed.diagnostics)
    ? parsed.diagnostics.flatMap((diagnostic) =>
        typeof diagnostic?.code === 'string' ? [diagnostic.code] : [],
      )
    : [];
  // A scenario with an assertion the target cannot evaluate is refused by the harness with
  // `TN_PLAYTEST_UNSUPPORTED_ON_TARGET`; that is a scenario/target mismatch, not a gameplay
  // failure, and it must say so instead of surfacing as "the game failed".
  const unsupported = diagnostics.find((code) => code.endsWith('UNSUPPORTED_ON_TARGET'));
  if (unsupported !== undefined)
    throw consumerError(
      'SCENARIO_NOT_CROSS_TARGET',
      `the '${target}' runner refused the shared consumer scenario with ${unsupported}: it is only runnable on the target it was authored for. Give it a scenario-owned waiver or a target-specific scenario.`,
    );
  if (!Array.isArray(parsed.assertionResults))
    throw consumerError(
      'NO_ASSERTIONS',
      `the '${target}' run never reached assertion evaluation, so nothing was proven.`,
    );
  if (parsed.assertionResults.length === 0)
    throw consumerError('NO_ASSERTIONS', `the '${target}' run evaluated zero assertions.`);
  const failures = parsed.assertionResults
    .filter((result) => result?.pass === false)
    .map((result) => result?.id ?? result?.name ?? result?.code ?? 'assertion');
  return {
    assertions: parsed.assertionResults.length,
    diagnostics,
    failures,
    pass: parsed.pass === true,
  };
}

function readConsumerApplicationId(projectRoot) {
  const config = join(projectRoot, 'threenative.config.ts');
  if (!existsSync(config))
    throw consumerError(
      'APPLICATION_ID_MISSING',
      `${config} is absent, so the built consumer's application id cannot be read.`,
    );
  const match = /id\s*:\s*["'`]([^"'`]+)["'`]/u.exec(readFileSync(config, 'utf8'));
  if (match === null || match[1].includes('__'))
    throw consumerError(
      'APPLICATION_ID_MISSING',
      `no concrete app.id was found in ${config}.`,
    );
  return match[1];
}

function firstFile(root, predicate) {
  const stack = [root];
  while (stack.length > 0) {
    const directory = stack.pop();
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        stack.push(file);
      } else if (entry.isFile() && predicate(file)) return file;
    }
  }
  return undefined;
}

function discoverConsumerArtifact(projectRoot, target) {
  if (target === 'desktop') {
    const manifest = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
    const name = basename(String(manifest.name ?? 'starter').replace(/^@[^/]+\//u, ''));
    return join(projectRoot, 'dist-native', `${name}${process.platform === 'win32' ? '.exe' : ''}`);
  }
  const apk = firstFile(join(projectRoot, 'dist-native'), (file) => file.endsWith('.apk'));
  if (apk === undefined)
    throw consumerError(
      'ARTIFACT_MISSING',
      `no .apk was found under ${join(projectRoot, 'dist-native')}; build the Android consumer first.`,
    );
  return apk;
}

/**
 * The Android row must name the device it ran on, not the host that drove it. `adb` is frequently
 * installed but off `PATH`, so `ADB` overrides the command; a probe that cannot read is a failure,
 * never a default.
 */
function adbDeviceIdentity(device) {
  const adb = process.env.ADB ?? 'adb';
  const probe = (property) => {
    const result = spawnSync(adb, ['-s', device, 'shell', 'getprop', property], {
      encoding: 'utf8',
      timeout: 15_000,
    });
    const value = `${result.stdout ?? ''}`.trim();
    if (result.status !== 0 || value.length === 0)
      throw consumerError(
        'DEVICE_IDENTITY_UNREADABLE',
        `adb could not read ${property} from ${device}: ${(result.stderr ?? '').trim() || 'no output'}.`,
      );
    return value;
  };
  return {
    architecture: probe('ro.product.cpu.abi'),
    osVersion: `${probe('ro.build.version.release')} (API ${probe('ro.build.version.sdk')})`,
  };
}

function recordConsumerTargetRow(projectRoot, row) {
  const directory = join(projectRoot, 'artifacts', 'native');
  mkdirSync(directory, { recursive: true });
  const file = join(directory, 'consumer-targets.json');
  let rows = [];
  if (existsSync(file)) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      throw consumerError(
        'ROW_MALFORMED',
        `${file} is not readable JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!Array.isArray(parsed))
      throw consumerError('ROW_MALFORMED', `${file} is not a row array; refusing to overwrite it.`);
    rows = parsed;
  }
  rows = rows.filter((candidate) => candidate?.target !== row.target);
  rows.push(row);
  writeFileSync(file, `${JSON.stringify(rows, null, 2)}\n`);
  return file;
}

function defaultConsumerRunner(command, args, cwd) {
  const timeoutMs = Number(process.env.TN_STARTER_CONSUMER_TIMEOUT_MS ?? 900_000);
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs,
  });
  return { status: result.status, stderr: result.stderr ?? '', stdout: result.stdout ?? '' };
}

/**
 * Run the same consumer scenario phase 1 drove in the browser through the *installed* runner for
 * one distributed target, and return the qualified row. `run`/`runner` is injectable so the unit
 * contract needs no display, no device and no real playtest.
 */
export function verifyStarterConsumerGameplay(options = {}) {
  const target = options.target;
  if (!CONSUMER_REQUIRED_TARGETS.includes(target))
    throw consumerError(
      'TARGET_UNSUPPORTED',
      `'${String(target)}' is not a distributed consumer target; use one of ${CONSUMER_REQUIRED_TARGETS.join(', ')}.`,
    );
  const projectRoot = resolve(options.project ?? process.cwd());
  const scenario = options.scenario ?? CONSUMER_GAMEPLAY_SCENARIO;
  const applicationId = options.applicationId ?? readConsumerApplicationId(projectRoot);
  const artifact = resolve(
    options.artifact ?? discoverConsumerArtifact(projectRoot, target),
  );
  if (!existsSync(artifact))
    throw consumerError(
      'ARTIFACT_MISSING',
      `${artifact} does not exist; build the consumer before qualifying it.`,
    );
  const cli = join(
    projectRoot,
    'node_modules',
    '@threenative',
    'playtest',
    'dist',
    'runner',
    'cli.js',
  );
  if (!existsSync(cli))
    throw consumerError(
      'RUNNER_MISSING',
      `${cli} is absent; the installed runner is what proves gameplay, not a repository checkout.`,
    );
  const android = target === 'android';
  const device = android
    ? (options.device ?? process.env.TN_ANDROID_SERIAL ?? 'emulator-5554')
    : undefined;
  const args = [scenario, '--target', target];
  if (android) args.push('--device', device);
  else args.push('--executable', artifact);
  const runner = options.runner ?? defaultConsumerRunner;
  const result = runner(process.execPath, [cli, ...args], projectRoot);
  const log = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
  const report = parseConsumerPlaytestReport(result.stdout ?? '', target);
  // A runner that prints a passing report but exits non-zero is malformed, not a pass.
  if (report.pass && typeof result.status === 'number' && result.status !== 0)
    throw consumerError(
      'ROW_MALFORMED',
      `the '${target}' runner reported pass but exited ${result.status}; refusing the contradiction.`,
    );
  const deviceIdentity =
    android && (options.osVersion === undefined || options.architecture === undefined)
      ? adbDeviceIdentity(device)
      : undefined;
  const artifactHash = createHash('sha256').update(readFileSync(artifact)).digest('hex');
  const row = {
    applicationId,
    architecture: options.architecture ?? deviceIdentity?.architecture ?? process.arch,
    artifactHash,
    assertions: report.assertions,
    failures: report.failures,
    log: log.slice(-4000),
    os: options.os ?? (android ? 'android' : process.platform),
    osVersion: options.osVersion ?? deviceIdentity?.osVersion ?? osRelease(),
    pass: report.pass,
    scenario,
    session:
      options.session ??
      (android
        ? String(device).startsWith('emulator-')
          ? 'android-emulator'
          : 'android-device'
        : describeConsumerSession(process.platform)),
    target,
  };
  // The caller may supply the built consumer's identity independently (a build manifest, a prior
  // qualification); otherwise the run qualifies against the artifact it just hashed. A supplied
  // identity is what turns a stale or substituted row into `ARTIFACT_MISMATCH` rather than a pass.
  const expected = options.expected ?? { applicationId, artifactHash, scenario };
  qualifyConsumerTargetRow(row, expected);
  recordConsumerTargetRow(projectRoot, row);
  return { expected, row };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href &&
  (process.argv.includes('--consumer') || process.argv.includes('--qualify-existing'))
) {
  const optionValue = (name, fallback) => {
    const index = process.argv.indexOf(name);
    return index === -1 ? fallback : process.argv[index + 1];
  };
  try {
    if (process.argv.includes('--qualify-existing')) {
      // Re-qualify the persisted row against the consumer as it is built right now. This is where
      // a stale row is caught: a rebuild changes the artifact hash, and the recorded row no longer
      // matches the built consumer.
      const target = optionValue('--target', 'desktop');
      const project = resolve(optionValue('--project', process.cwd()));
      const applicationId =
        optionValue('--application-id', undefined) ?? readConsumerApplicationId(project);
      const artifact = resolve(
        optionValue('--artifact', undefined) ?? discoverConsumerArtifact(project, target),
      );
      const artifactHash = createHash('sha256').update(readFileSync(artifact)).digest('hex');
      const file = join(project, 'artifacts', 'native', 'consumer-targets.json');
      if (!existsSync(file))
        throw consumerError('ROW_MISSING', `${file} is absent; run --consumer first.`);
      const rows = JSON.parse(readFileSync(file, 'utf8'));
      assertConsumerTargetRows(rows, {
        applicationId,
        artifactHash,
        scenario: optionValue('--scenario', CONSUMER_GAMEPLAY_SCENARIO),
        targets: [target],
      });
      console.log(`existing ${target} consumer row matches the built consumer ${artifactHash.slice(0, 12)}`);
      process.exit(0);
    }
    const { row } = verifyStarterConsumerGameplay({
      applicationId: optionValue('--application-id', undefined),
      artifact: optionValue('--artifact', undefined),
      device: optionValue('--device', undefined),
      project: optionValue('--project', process.cwd()),
      target: optionValue('--target', 'desktop'),
    });
    console.log(
      `consumer gameplay qualified on ${row.target}: ${row.assertions} assertions, artifact ${row.artifactHash.slice(0, 12)}, app ${row.applicationId}`,
    );
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
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

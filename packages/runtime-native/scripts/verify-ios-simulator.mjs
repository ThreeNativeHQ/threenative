#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { assertIosRuntime, bundleIsRegistered, selectIosSimulator } from './select-ios-simulator.mjs';
// The same two assertions the desktop and Android gates run, from one source. A third copy would
// drift, and the copy that drifts is always the lane nobody runs by hand.
import { analyzePresentTicks, inspectOverlayBuffer } from './verify-desktop-core.mjs';

const runtimeRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = join(runtimeRoot, '..', '..');
const artifactRoot = join(runtimeRoot, 'artifacts', 'ios');
const buildRoot = join(runtimeRoot, 'build', 'tn-ios-simulator');
const bundle = join(workspaceRoot, 'examples', 'native-smoke', 'dist', 'native-smoke.js');
const nativeSmokeRoot = join(workspaceRoot, 'examples', 'native-smoke');
const bundleId = 'dev.threenative.runtime';
const checkOnly = process.argv.includes('--check');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? workspaceRoot,
    encoding: 'utf8',
    env: options.env ?? process.env,
    maxBuffer: 32 * 1024 * 1024,
    stdio: options.stdio,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed (${result.status}):\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout;
}

function runExpected(command, args, expectedStatus, expectedText) {
  const result = spawnSync(command, args, {
    cwd: workspaceRoot,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120_000,
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.error) throw result.error;
  if (result.status !== expectedStatus || !output.includes(expectedText)) {
    throw new Error(
      `Expected exit ${expectedStatus} containing ${expectedText}, got ${result.status}:\n${output}`,
    );
  }
  return { expectedStatus, expectedText };
}

function validateScaffold() {
  const required = ['ios/Info.plist', 'ios/main.mm', 'ios/ui_overlay_ios.mm', 'CMakeLists.txt'];
  for (const path of required) {
    if (!existsSync(join(runtimeRoot, path))) throw new Error(`iOS scaffold is missing ${path}.`);
  }
  const cmake = readFileSync(join(runtimeRoot, 'CMakeLists.txt'), 'utf8');
  const main = readFileSync(join(runtimeRoot, 'ios', 'main.mm'), 'utf8');
  const plist = readFileSync(join(runtimeRoot, 'ios', 'Info.plist'), 'utf8');
  if (!cmake.includes('add_executable(threenative-ios MACOSX_BUNDLE')) {
    throw new Error('CMake does not declare the root-linked threenative-ios app target.');
  }
  if (!cmake.includes('examples/native-smoke/dist/native-smoke.js')) {
    throw new Error('iOS app target is not linked to the shared native-smoke bundle.');
  }
  if (!main.includes('TN_PLAYTEST_MAILBOX') || !main.includes('native-smoke')) {
    throw new Error('iOS entry point is missing the shared proof or playtest mailbox.');
  }
  if (
    (!plist.includes('$(PRODUCT_BUNDLE_IDENTIFIER)') && !plist.includes('com.threenative.game')) ||
    !plist.includes('<string>metal</string>')
  ) {
    throw new Error('iOS Info.plist is missing its bundle identifier or Metal requirement.');
  }
}

function validateThreeVersion() {
  const workspace = readFileSync(join(workspaceRoot, 'pnpm-workspace.yaml'), 'utf8');
  const catalogMatch = workspace.match(/^\s*three:\s*['"]?([^'"\s]+)['"]?\s*$/mu);
  if (!catalogMatch?.[1]) throw new Error('pnpm-workspace.yaml has no catalog Three.js version.');
  const installedManifest = join(nativeSmokeRoot, 'node_modules', 'three', 'package.json');
  if (!existsSync(installedManifest)) {
    throw new Error('Native smoke Three.js dependency is missing. Run pnpm install --frozen-lockfile.');
  }
  const installed = JSON.parse(readFileSync(installedManifest, 'utf8')).version;
  if (installed !== catalogMatch[1]) {
    throw new Error(`iOS proof Three.js mismatch: catalog ${catalogMatch[1]}, installed ${installed}.`);
  }
  return installed;
}

function findApp(root) {
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (entry === 'threenative-ios.app') return path;
    if (statSync(path).isDirectory()) {
      const nested = findApp(path);
      if (nested) return nested;
    }
  }
  return undefined;
}

function chooseSimulator() {
  const parsed = JSON.parse(run('xcrun', ['simctl', 'list', 'devices', 'available', '--json']));
  const selected = selectIosSimulator(parsed);
  assertIosRuntime(selected.runtime);
  if (selected.state !== 'Booted') run('xcrun', ['simctl', 'boot', selected.udid]);
  run('xcrun', ['simctl', 'bootstatus', selected.udid, '-b']);
  return selected;
}

function awaitBundleRegistration(device, identifier, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastReason = 'never listed';
  for (;;) {
    const result = spawnSync('xcrun', ['simctl', 'listapps', device], { encoding: 'utf8' });
    if (result.status === 0 && bundleIsRegistered(result.stdout ?? '', identifier)) return;
    lastReason = (result.stderr ?? '').trim() || `${identifier} not listed`;
    if (Date.now() >= deadline) {
      throw new Error(
        `simctl never registered ${identifier} on ${device} within ${timeoutMs}ms: ${lastReason}`,
      );
    }
    sleep(1_000);
  }
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function unifiedLog(device, since) {
  return run('xcrun', [
    'simctl', 'spawn', device, 'log', 'show', '--style', 'compact', '--start', since,
    '--predicate', 'process == "threenative-ios"',
  ]);
}

function launchDiagnostics(device, since) {
  const predicate = [
    `process == "threenative-ios"`,
    `eventMessage CONTAINS "${bundleId}"`,
    `eventMessage CONTAINS "FBSOpenApplicationServiceErrorDomain"`,
  ].join(' OR ');
  const result = spawnSync('xcrun', [
    'simctl', 'spawn', device, 'log', 'show', '--style', 'compact', '--start', since,
    '--predicate', predicate,
  ], {
    cwd: workspaceRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return `${result.stdout || ''}\n${result.stderr || ''}`.trim();
}

function validateScreenshot(path) {
  const png = PNG.sync.read(readFileSync(path));
  let min = 255;
  let max = 0;
  for (let index = 0; index < png.data.length; index += 4) {
    const luminance = (png.data[index] + png.data[index + 1] + png.data[index + 2]) / 3;
    min = Math.min(min, luminance);
    max = Math.max(max, luminance);
  }
  if (png.width < 320 || png.height < 320 || max - min < 12) {
    throw new Error(`iOS simulator screenshot is blank or implausible (${png.width}x${png.height}, range ${max - min}).`);
  }
  return { height: png.height, luminanceRange: max - min, width: png.width };
}

validateScaffold();
const threeVersion = validateThreeVersion();
if (checkOnly) {
  run(process.execPath, ['scripts/build-native-physics.mjs', '--ios-simulator', '--check'], {
    cwd: runtimeRoot,
  });
  console.log(JSON.stringify({ checked: true, execution: false, reason: 'static scaffold validation only', threeVersion }));
  process.exit(0);
}
if (process.platform !== 'darwin') {
  throw new Error('iOS simulator execution requires macOS with Xcode; static validation is available with --check.');
}

run('pnpm', ['--filter', 'threenative-native-smoke', 'build']);
run('pnpm', ['--filter', '@threenative/playtest', 'build']);
run(process.execPath, ['scripts/download-deps.mjs', '--only', 'sdl3'], { cwd: runtimeRoot });
run(process.execPath, ['scripts/download-deps.mjs', '--only', 'wgpu-ios'], { cwd: runtimeRoot });
run(process.execPath, ['scripts/download-deps.mjs', '--only', 'stb'], { cwd: runtimeRoot });
run(process.execPath, ['scripts/build-native-physics.mjs', '--ios-simulator'], { cwd: runtimeRoot });
run('cmake', [
  '-S', runtimeRoot,
  '-B', buildRoot,
  '-G', 'Xcode',
  `-DCMAKE_TOOLCHAIN_FILE=${join(runtimeRoot, 'cmake', 'ios.toolchain.cmake')}`,
  '-DPLATFORM=SIMULATORARM64',
  '-DCMAKE_OSX_ARCHITECTURES=arm64',
  '-DTN_ENABLE_CANVAS2D=OFF',
  '-DTN_ENABLE_VIDEO=OFF',
  '-DTN_ENABLE_RAYTRACING=OFF',
  '-DTN_ENABLE_WEBTRANSPORT=OFF',
  '-DTN_ENABLE_NATIVE_GLTF=OFF',
  '-DTN_ENABLE_NATIVE_PHYSICS=ON',
  '-DCMAKE_XCODE_ATTRIBUTE_CODE_SIGNING_ALLOWED=NO',
]);
const rebuildApp = () =>
  run('cmake', ['--build', buildRoot, '--config', 'Release', '--target', 'threenative-ios', '--parallel'], {
    stdio: 'inherit',
  });
const rebuildProof = (control, physics) => {
  run('pnpm', ['--filter', 'threenative-native-smoke', 'build'], {
    env: {
      ...process.env,
      THREENATIVE_PHYSICS_CONTROL: control,
      THREENATIVE_PHYSICS_PROOF: physics ? 'enabled' : 'disabled',
    },
  });
  rebuildApp();
};
rebuildApp();
const app = findApp(buildRoot);
if (!app) throw new Error('CMake succeeded but threenative-ios.app was not produced.');
if (!existsSync(join(app, 'native-smoke.js'))) throw new Error('Built iOS app omitted native-smoke.js.');

mkdirSync(artifactRoot, { recursive: true });
const simulator = chooseSimulator();
run('xcrun', ['simctl', 'install', simulator.udid, app]);
// `simctl install` returns once the bundle is on disk, which is before LaunchServices has
// registered it. Launching inside that window fails with FBSOpenApplicationErrorDomain code 4,
// "NotFound" — SpringBoard reporting that its application info provider returned nil for a bundle
// that is sitting right there. Wait for the registration itself rather than for a fixed delay,
// which would be a guess about a machine's speed.
awaitBundleRegistration(simulator.udid, bundleId);
const startedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
let launch;
try {
  launch = run('xcrun', ['simctl', 'launch', '--terminate-running-process', simulator.udid, bundleId]);
} catch (error) {
  const diagnostics = launchDiagnostics(simulator.udid, startedAt);
  writeFileSync(join(artifactRoot, 'simulator-launch-failure.log'), diagnostics);
  throw new Error(`${error instanceof Error ? error.message : String(error)}\n\niOS launch diagnostics:\n${diagnostics}`);
}
if (!/:\s*\d+\b/u.test(launch)) throw new Error(`simctl launch did not report a pid: ${launch}`);

const requiredMarkers = [
  'TN_NATIVE_SMOKE_READY:webgpu',
  'TN_NATIVE_SMOKE_FIRST_FRAME',
  'TN_NATIVE_SMOKE_300_FRAMES:300',
];
let logs = '';
const deadline = Date.now() + 90_000;
while (Date.now() < deadline) {
  sleep(2_000);
  logs = unifiedLog(simulator.udid, startedAt);
  if (requiredMarkers.every((marker) => logs.includes(marker))) break;
}
const missingMarkers = requiredMarkers.filter((marker) => !logs.includes(marker));
if (missingMarkers.length > 0) {
  // The app launched and reported a pid, so "markers missing" alone says nothing about why: it
  // covers a crash on startup, a runtime that never reached its first frame, and a log predicate
  // that simply matched nothing. Those need different fixes, and this lane cannot be reproduced
  // off a Mac — so the failure has to carry its own evidence rather than cost another CI round.
  const broad = spawnSync(
    'xcrun',
    [
      'simctl', 'spawn', simulator.udid, 'log', 'show', '--style', 'compact', '--start', startedAt,
      '--predicate',
      `process == "threenative-ios" OR senderImagePath CONTAINS "threenative-ios" OR eventMessage CONTAINS "${bundleId}"`,
    ],
    { cwd: workspaceRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const broadLog = `${broad.stdout ?? ''}${broad.stderr ?? ''}`;
  writeFileSync(join(artifactRoot, 'simulator-marker-timeout.log'), `${logs}\n---- broad ----\n${broadLog}`);
  const tail = broadLog.split('\n').slice(-60).join('\n');
  throw new Error(
    `iOS proof missed markers: ${missingMarkers.join(', ')}\n` +
      `Process-filtered log was ${logs.length} bytes; the broader log tail follows.\n${tail}`,
  );
}
if (/GPUValidationError|Validation Error|TN_IOS_PROOF_FAILED|TypeError|ReferenceError|FATAL/u.test(logs)) {
  throw new Error('iOS unified logs contain a native, JavaScript, or WebGPU failure.');
}
// One present per frame. The app has reported 300 frames by now, so the runtime has emitted five
// ticks; a log with none means nothing measured the invariant, which is a failure and not a pass.
const presentTicks = analyzePresentTicks(logs, { minTicks: 1 });
if (presentTicks.failures.length > 0) {
  throw new Error(`iOS present invariant failed:\n${presentTicks.failures.join('\n')}`);
}

const screenshot = join(artifactRoot, 'simulator-core.png');
run('xcrun', ['simctl', 'io', simulator.udid, 'screenshot', screenshot]);
const image = validateScreenshot(screenshot);
// The blank/luminance check above passes on a half-drawn frame. This looks for the canvas-layer
// overlay's own colour, which nothing in the smoke world draws.
const overlay = inspectOverlayBuffer(readFileSync(screenshot), { label: screenshot });
writeFileSync(join(artifactRoot, 'simulator.log'), logs);
const playtestCli = join(workspaceRoot, 'packages', 'playtest', 'dist', 'runner', 'cli.js');
const scenarioRoot = join(workspaceRoot, 'examples', 'native-smoke', 'playtests');
const playtestArgs = (scenario, artifactName) => [
  playtestCli,
  join(scenarioRoot, scenario),
  '--target', 'ios',
  '--app', app,
  '--bundle-id', bundleId,
  '--device', simulator.udid,
  '--artifacts', join(artifactRoot, artifactName),
  '--timeout', '30000',
];
const devicePlaytest = {
  pass: runExpected(process.execPath, playtestArgs('device-smoke.playtest.json', 'playtest-pass'), 0, '"pass": true'),
  wrongValue: runExpected(process.execPath, playtestArgs('device-smoke-wrong-value.playtest.json', 'playtest-wrong'), 1, 'TN_PLAYTEST_VISIBILITY_FAILED'),
  misspelled: runExpected(process.execPath, playtestArgs('device-smoke-misspelled.playtest.json', 'playtest-misspelled'), 2, 'TN_PLAYTEST_SCENARIO_INVALID'),
  unsupportedNetwork: runExpected(process.execPath, playtestArgs('device-smoke-network.playtest.json', 'playtest-network'), 2, 'TN_PLAYTEST_UNSUPPORTED_ON_TARGET'),
};
try {
  run('pnpm', ['--filter', 'threenative-native-smoke', 'build'], {
    env: { ...process.env, THREENATIVE_PLAYTEST_BRIDGE: 'disabled' },
  });
  rebuildApp();
  devicePlaytest.missingBridge = runExpected(
    process.execPath,
    playtestArgs('device-smoke.playtest.json', 'playtest-missing-bridge'),
    2,
    'TN_PLAYTEST_BRIDGE_MISSING',
  );
} finally {
  rebuildProof('normal', false);
}
const nativePhysics = {};
try {
  rebuildProof('normal', true);
  nativePhysics.pass = runExpected(
    process.execPath,
    playtestArgs('physics.playtest.json', 'physics-pass'),
    0,
    '"pass": true',
  );
  nativePhysics.wrongHeight = runExpected(
    process.execPath,
    playtestArgs('physics-wrong-height.playtest.json', 'physics-wrong-height'),
    1,
    'TN_PLAYTEST_POSITION_REACH_ASSERTION_FAILED',
  );
  nativePhysics.maskAgainstNormal = runExpected(
    process.execPath,
    playtestArgs('physics-mask.playtest.json', 'physics-mask-normal'),
    1,
    'TN_PLAYTEST_MOVEMENT_ASSERTION_FAILED',
  );

  rebuildProof('masked', true);
  nativePhysics.masked = runExpected(
    process.execPath,
    playtestArgs('physics-mask.playtest.json', 'physics-mask-pass'),
    0,
    '"pass": true',
  );

  rebuildProof('wrong-gravity', true);
  nativePhysics.wrongGravity = runExpected(
    process.execPath,
    playtestArgs('physics.playtest.json', 'physics-wrong-gravity'),
    1,
    'TN_PLAYTEST_POSITION_REACH_ASSERTION_FAILED',
  );
} finally {
  rebuildProof('normal', false);
}
const report = {
  app: relative(workspaceRoot, app),
  bundle: {
    bytes: statSync(bundle).size,
    sha256: createHash('sha256').update(readFileSync(bundle)).digest('hex'),
  },
  completedAt: new Date().toISOString(),
  devicePlaytest,
  markers: requiredMarkers,
  pass: true,
  nativePhysics,
  threeVersion,
  presents: {
    lastFrames: presentTicks.ticks.at(-1)?.frames ?? null,
    lastPresents: presentTicks.ticks.at(-1)?.presents ?? null,
    ticks: presentTicks.ticks.length,
  },
  screenshot: {
    ...image,
    ...overlay,
    path: relative(workspaceRoot, screenshot),
    sha256: createHash('sha256').update(readFileSync(screenshot)).digest('hex'),
  },
  simulator: { name: simulator.name, runtime: simulator.runtime, udid: simulator.udid },
};
writeFileSync(join(artifactRoot, 'simulator-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

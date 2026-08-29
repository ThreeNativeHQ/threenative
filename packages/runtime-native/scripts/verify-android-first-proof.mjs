#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { PNG } from 'pngjs';
import {
  EXPECTED_THREE_VERSION,
  AUDIO_PROMISE_MARKER,
  FIRST_FRAME_MARKER,
  FRAME_MARKER,
  READY_MARKER,
  THREE_VERSION_MARKER,
  sourceTreeSha256,
} from './build-android-first-proof.mjs';
// Shared with the desktop gate on purpose. Two device-lane copies of "is the overlay there" would
// drift, and the weaker one would be the device's, which is the lane that had never asserted it.
import { analyzePresentTicks, inspectOverlayBuffer } from './verify-desktop-core.mjs';

export { AUDIO_PROMISE_MARKER, FIRST_FRAME_MARKER, FRAME_MARKER, READY_MARKER, THREE_VERSION_MARKER };

export const APP_ID = 'com.threenative.game';
export const ACTIVITY_CLASS = 'com.threenative.runtime.MystralActivity';
export const ACTIVITY = `${APP_ID}/${ACTIVITY_CLASS}`;
export const SUCCESS_MARKER = FRAME_MARKER,
  prepareAndroidEmulator = (serial, execute) => {
    if (serial.startsWith('emulator-'))
      execute('shell', 'settings', 'put', 'secure', 'immersive_mode_confirmations', 'confirmed');
    return { prepared: serial.startsWith('emulator-') };
  };
export const REQUIRED_MARKERS = [THREE_VERSION_MARKER, READY_MARKER, FIRST_FRAME_MARKER, FRAME_MARKER];
// Required but deliberately outside REQUIRED_MARKERS: those are order-checked, and where a
// microtask-delivered result lands relative to the frame markers is timing, not contract.
export const UNORDERED_REQUIRED_MARKERS = [AUDIO_PROMISE_MARKER];

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = resolve(root, '..', '..');
const defaultApk = join(root, 'android/app/build/outputs/apk/debug/app-debug.apk');
const defaultLogPath = join(root, 'artifacts/android/first-proof-logcat.txt');
const defaultReportPath = join(root, 'artifacts/android/first-proof-report.json');
const defaultScreenshotPath = join(root, 'artifacts/android/first-proof.png');
const bundlePath = join(root, 'android/app/build/generated/threenative/assets/scripts/main.js');
const bundleMetadataPath = `${bundlePath}.meta.json`;

class GateError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'GateError';
    this.details = details;
  }
}

function usage() {
  return `Usage: node scripts/verify-android-first-proof.mjs [options]

Build, install, launch, and verify the Android Three.js WebGPU first proof.

Options:
  --device SERIAL       Target one connected device (required when multiple are online)
  --timeout-ms N        Wait up to N milliseconds for the success marker (default: 45000)
  --settle-ms N         Require the process to remain alive N ms after success (default: 3000)
  --apk PATH            APK to install (default: android/app/build/outputs/apk/debug/app-debug.apk)
  --logcat PATH         Captured app log output (default: artifacts/android/first-proof-logcat.txt)
  --report PATH         JSON proof report (default: artifacts/android/first-proof-report.json)
  --screenshot PATH     Required PNG proof path (default: artifacts/android/first-proof.png)
  --expect-engine NAME  Require the running process to report this engine (v8 or quickjs)
  --skip-build          Reuse the existing debug APK
  --skip-install        Reuse the currently installed app
  --help                Show this help

Tool overrides:
  THREENATIVE_ADB, THREENATIVE_ANDROID_SDK, THREENATIVE_JAVA_HOME
`;
}

export function parseArgs(argv) {
  const options = {
    device: null,
    timeoutMs: 45000,
    settleMs: 3000,
    apk: defaultApk,
    logPath: defaultLogPath,
    reportPath: defaultReportPath,
    screenshotPath: defaultScreenshotPath,
    skipBuild: false,
    skipInstall: false,
    expectEngine: null,
    help: false,
  };

  const valueOptions = new Map([
    ['--device', 'device'],
    ['--timeout-ms', 'timeoutMs'],
    ['--settle-ms', 'settleMs'],
    ['--apk', 'apk'],
    ['--logcat', 'logPath'],
    ['--report', 'reportPath'],
    ['--screenshot', 'screenshotPath'],
    // What the running process must report at runtime.cpp:450. Not the build flag: see assertEngine.
    ['--expect-engine', 'expectEngine'],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--skip-build') options.skipBuild = true;
    else if (arg === '--skip-install') options.skipInstall = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (valueOptions.has(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new GateError(`${arg} requires a value.`);
      options[valueOptions.get(arg)] = value;
      index += 1;
    } else {
      throw new GateError(`Unknown option: ${arg}. Run with --help for supported options.`);
    }
  }

  for (const key of ['timeoutMs', 'settleMs']) {
    const value = Number(options[key]);
    if (!Number.isInteger(value) || value < 0) {
      throw new GateError(`--${key === 'timeoutMs' ? 'timeout-ms' : 'settle-ms'} must be a non-negative integer.`);
    }
    options[key] = value;
  }
  if (options.timeoutMs < 1000) throw new GateError('--timeout-ms must be at least 1000.');
  if (options.expectEngine !== null) {
    const engine = String(options.expectEngine).toLowerCase();
    if (engine !== 'v8' && engine !== 'quickjs') {
      throw new GateError(`--expect-engine must be v8 or quickjs, got '${options.expectEngine}'.`);
    }
    options.expectEngine = engine;
  }

  for (const key of ['apk', 'logPath', 'reportPath', 'screenshotPath']) {
    if (options[key] && !isAbsolute(options[key])) options[key] = resolve(process.cwd(), options[key]);
  }
  return options;
}

function executableName(name) {
  return process.platform === 'win32' && !name.endsWith('.exe') ? `${name}.exe` : name;
}

function findOnPath(name, env = process.env) {
  const pathValue = env.PATH || '';
  for (const directory of pathValue.split(process.platform === 'win32' ? ';' : ':')) {
    if (!directory) continue;
    const candidate = join(directory, executableName(name));
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function readSdkFromLocalProperties() {
  const path = join(root, 'android/local.properties');
  if (!existsSync(path)) return null;
  const match = readFileSync(path, 'utf8').match(/^sdk\.dir=(.+)$/m);
  return match ? match[1].trim().replace(/\\:/g, ':').replace(/\\\\/g, '\\') : null;
}

export function javaMajorFromRelease(javaHome) {
  const releasePath = join(javaHome, 'release');
  if (!existsSync(releasePath)) return null;
  const match = readFileSync(releasePath, 'utf8').match(/^JAVA_VERSION="([0-9]+)(?:\.[^"]*)?"/m);
  return match ? Number(match[1]) : null;
}

function javaCandidates(env = process.env) {
  const candidates = [
    env.THREENATIVE_JAVA_HOME,
    env.JAVA_HOME,
    '/usr/lib/jvm/java-17-openjdk',
    '/usr/lib/jvm/java-17-openjdk-amd64',
    '/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home',
    '/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home',
    join(homedir(), '.jdks', 'temurin-17'),
  ];
  const jvmRoot = '/usr/lib/jvm';
  if (existsSync(jvmRoot)) {
    for (const entry of readdirSync(jvmRoot).sort()) candidates.push(join(jvmRoot, entry));
  }
  return [...new Set(candidates.filter(Boolean))];
}

export function discoverTools(env = process.env) {
  const sdkCandidates = [
    env.THREENATIVE_ANDROID_SDK,
    env.ANDROID_SDK_ROOT,
    env.ANDROID_HOME,
    readSdkFromLocalProperties(),
    join(homedir(), 'Android', 'Sdk'),
    join(homedir(), 'Library', 'Android', 'sdk'),
  ].filter(Boolean);
  const sdkRoot = sdkCandidates.find((candidate) => existsSync(join(candidate, 'platform-tools', executableName('adb')))) || null;

  const adbOverride = env.THREENATIVE_ADB;
  const adb = (adbOverride && existsSync(adbOverride) ? adbOverride : null)
    || findOnPath('adb', env)
    || (sdkRoot ? join(sdkRoot, 'platform-tools', executableName('adb')) : null);
  if (!adb) {
    throw new GateError(
      'adb was not found. Install Android SDK Platform Tools or set THREENATIVE_ADB=/absolute/path/to/adb.',
    );
  }

  const javaHome = javaCandidates(env).find((candidate) => {
    return javaMajorFromRelease(candidate) === 17 && existsSync(join(candidate, 'bin', executableName('java')));
  });
  if (!javaHome) {
    throw new GateError(
      'JDK 17 was not found. Install JDK 17 or set THREENATIVE_JAVA_HOME=/absolute/path/to/jdk-17.',
    );
  }
  if (!sdkRoot) {
    throw new GateError(
      'Android SDK root was not found. Set THREENATIVE_ANDROID_SDK or ANDROID_SDK_ROOT to the SDK directory.',
    );
  }

  return { adb, javaHome, sdkRoot };
}

function commandText(command, args) {
  return [command, ...args].map((part) => /\s/.test(part) ? JSON.stringify(part) : part).join(' ');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    env: options.env || process.env,
    encoding: options.binary ? null : 'utf8',
    timeout: options.timeoutMs || 180000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    const reason = result.error.code === 'ETIMEDOUT' ? 'timed out' : result.error.message;
    throw new GateError(`Command ${reason}: ${commandText(command, args)}`, { cause: result.error });
  }
  if (result.status !== 0 && !options.allowFailure) {
    const stderr = String(result.stderr || '').trim();
    const stdout = String(result.stdout || '').trim();
    throw new GateError(
      `Command failed (${result.status}): ${commandText(command, args)}${stderr || stdout ? `\n${stderr || stdout}` : ''}`,
      { status: result.status, stdout, stderr },
    );
  }
  return result;
}

export function parseAdbDevices(output) {
  return output.split(/\r?\n/).slice(1).map((line) => {
    const match = line.trim().match(/^(\S+)\s+(device|offline|unauthorized)(?:\s|$)/);
    return match ? { serial: match[1], state: match[2] } : null;
  }).filter(Boolean);
}

export function selectDevice(devices, requestedSerial = null) {
  if (requestedSerial) {
    const device = devices.find(({ serial }) => serial === requestedSerial);
    if (!device) throw new GateError(`Android device ${requestedSerial} was not listed by adb devices.`);
    if (device.state !== 'device') {
      throw new GateError(`Android device ${requestedSerial} is ${device.state}. Unlock and authorize it, then retry.`);
    }
    return device.serial;
  }
  const online = devices.filter(({ state }) => state === 'device');
  if (online.length === 0) {
    const states = devices.length ? devices.map(({ serial, state }) => `${serial} (${state})`).join(', ') : 'none listed';
    throw new GateError(`No online Android device found (${states}). Start an emulator or connect and authorize a device.`);
  }
  if (online.length > 1) {
    throw new GateError(`Multiple Android devices are online: ${online.map(({ serial }) => serial).join(', ')}. Retry with --device SERIAL.`);
  }
  return online[0].serial;
}

const failureMatchers = [
  { kind: 'first-proof-failure', pattern: /\[ThreeNative Android\]\s+first proof failed:/i },
  // The generated conformance entry catches every scene throw and logs it here before staying
  // alive, so without this pattern a failing assertion burned the whole marker timeout and was
  // reported as a generic timeout instead of itself (PRD-166, probe run of 2026-08-22).
  { kind: 'scene-failure', pattern: /\[ThreeNative conformance\]\s*failed:/i },
  { kind: 'native-smoke-failure', pattern: /TN_NATIVE_SMOKE_FAILED:/i },
  { kind: 'audio-promise-failure', pattern: /TN_NATIVE_SMOKE_AUDIO_PROMISE_FAIL:/i },
  { kind: 'fatal-signal', pattern: /\bFatal signal\b|\bSIG(?:ABRT|BUS|FPE|ILL|SEGV|TRAP)\b/i },
  { kind: 'range-error', pattern: /\bRangeError\b/i },
  { kind: 'javascript-error', pattern: /\b(?:Uncaught|Unhandled promise rejection|SyntaxError|TypeError|ReferenceError|EvalError|URIError)\b/i },
  { kind: 'webgpu-error', pattern: /(?:WebGPU|wgpu(?:-native)?|GPUValidationError)[^\r\n]{0,180}\b(?:error|failed|failure|invalid|validation)\b/i },
  { kind: 'webgpu-error', pattern: /\b(?:error|failed|failure|invalid|validation)\b[^\r\n]{0,180}(?:WebGPU|wgpu(?:-native)?|GPUValidationError)/i },
  { kind: 'shader-error', pattern: /Device::create_shader_module error|Shader parsing error/i },
];

export function filterAppLog(log, pid) {
  if (!pid) return log;
  const pidPattern = new RegExp(`^\\S+\\s+\\S+\\s+${pid}\\s+\\d+\\s+[VDIWEF]\\s`, 'm');
  return log.split(/\r?\n/).filter((line) => {
    return (
      line.includes(APP_ID) ||
      REQUIRED_MARKERS.some((marker) => line.includes(marker)) ||
      UNORDERED_REQUIRED_MARKERS.some((marker) => line.includes(marker)) ||
      pidPattern.test(line)
    );
  }).join('\n');
}

/**
 * The engine the running process said it created, from `runtime.cpp:450`.
 *
 * A build flag says what was asked for. This says what launched. Those came apart once already:
 * `-DMYSTRAL_USE_V8=ON` was accepted on the command line, silently ignored, and reported back as
 * `V8=OFF` (PRD-118 §2), and every measurement taken in between described QuickJS while its author
 * believed otherwise. So no gate here infers the engine from the flag it passed.
 *
 * Returns `null` when the process never said — which is a failure for any caller that asked, and is
 * kept distinct from "said something else" because the two have different causes: a crash before
 * engine creation against a build that shipped the wrong engine.
 */
export function engineFromLog(log) {
  const match = /JS engine created:\s*(\S+)/i.exec(log);
  return match ? match[1] : null;
}

export function assertEngine(log, expected) {
  if (!expected) return { engine: engineFromLog(log), expected: null, matched: true };
  const engine = engineFromLog(log);
  if (engine === null) {
    throw new GateError(
      `Expected the ${expected} engine but the process never reported one. Either it died before creating an engine, or this build does not log "JS engine created".`,
    );
  }
  if (engine.toLowerCase() !== expected.toLowerCase()) {
    throw new GateError(
      `Engine mismatch: asked for ${expected}, the running process reported ${engine}. The installed APK is not the engine this gate is measuring.`,
    );
  }
  return { engine, expected, matched: true };
}

/**
 * @param log captured app log
 * @param requireTicks whether a missing present tick is itself a failure. False while the gate is
 *   still waiting for the app's markers -- the runtime emits a tick every 60 frames, so a log read
 *   one second into launch legitimately has none yet, and failing on that would reject every run.
 *   True once the app has reported its frames, where a log with no tick means nothing measured the
 *   invariant.
 */
export function analyzeAppLog(log, { requireTicks = false } = {}) {
  const failures = [];
  for (const matcher of failureMatchers) {
    const match = log.match(matcher.pattern);
    if (match) {
      const line = log.slice(0, match.index).split(/\r?\n/).length;
      failures.push({ kind: matcher.kind, line, excerpt: log.split(/\r?\n/)[line - 1]?.trim() || match[0] });
    }
  }
  const markerIndexes = REQUIRED_MARKERS.map((marker) => log.indexOf(marker));
  const missingMarkers = REQUIRED_MARKERS.filter((_marker, index) => markerIndexes[index] === -1);
  const missingUnordered = UNORDERED_REQUIRED_MARKERS.filter((marker) => !log.includes(marker));
  missingMarkers.push(...missingUnordered);
  if (missingMarkers.length === 0 && markerIndexes.some((value, index) => index > 0 && value <= markerIndexes[index - 1])) {
    failures.push({
      kind: 'marker-order',
      line: 1,
      excerpt: `Expected marker order: ${REQUIRED_MARKERS.join(' -> ')}`,
    });
  }
  // One present per frame, read from the running process. The desktop CLI prints its count once
  // at the end of a fixed-frame run; a device app never ends, so the runtime emits the pair
  // periodically and this reads it. Without it the device lane asserts a screenshot and nothing
  // about what actually reached the display.
  for (const failure of analyzePresentTicks(log, { minTicks: requireTicks ? 1 : 0 }).failures) {
    failures.push({ kind: 'present-invariant', line: 1, excerpt: failure });
  }
  return {
    markerFound: missingMarkers.length === 0,
    missingMarkers,
    failures,
  };
}

function adbArgs(serial, ...args) {
  return ['-s', serial, ...args];
}

function getPid(adb, serial, execute = run) {
  const result = execute(adb, adbArgs(serial, 'shell', 'pidof', APP_ID), { allowFailure: true, timeoutMs: 10000 });
  if (result.status !== 0) return null;
  return String(result.stdout).trim().split(/\s+/).find(Boolean) || null;
}

function captureLog(adb, serial, execute = run) {
  const result = execute(adb, adbArgs(serial, 'logcat', '-d', '-v', 'threadtime'), { timeoutMs: 15000 });
  return String(result.stdout || '');
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function pngDimensions(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) {
    throw new GateError('adb screenshot output was not a valid PNG.');
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

export function inspectScreenshot(buffer) {
  const dimensions = pngDimensions(buffer);
  const png = PNG.sync.read(buffer);
  const colors = new Set();
  let opaquePixels = 0;
  for (let index = 0; index < png.data.length; index += 4) {
    if (png.data[index + 3] === 0) continue;
    opaquePixels += 1;
    colors.add(`${png.data[index]},${png.data[index + 1]},${png.data[index + 2]}`);
    if (colors.size >= 2) break;
  }
  if (opaquePixels === 0 || colors.size < 2) {
    throw new GateError('Android screenshot is blank; expected at least two opaque colors.');
  }
  return dimensions;
}

function writeText(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

export function verifyAndroidBundle() {
  for (const path of [bundlePath, bundleMetadataPath]) {
    if (!existsSync(path)) {
      throw new GateError(`Android native smoke asset is missing: ${path}. Build without --skip-build.`);
    }
  }
  const bundle = readFileSync(bundlePath);
  let metadata;
  try {
    metadata = JSON.parse(readFileSync(bundleMetadataPath, 'utf8'));
  } catch (error) {
    throw new GateError(`Android native smoke metadata is invalid: ${error instanceof Error ? error.message : error}`);
  }
  if (metadata.schemaVersion !== 1 || metadata.publicApiPackage !== '@threenative/core') {
    throw new GateError('Android asset metadata does not identify the public @threenative/core smoke.');
  }
  if (metadata.catalogThree !== EXPECTED_THREE_VERSION || metadata.installedThree !== EXPECTED_THREE_VERSION) {
    throw new GateError(
      `Android asset Three.js mismatch: expected=${EXPECTED_THREE_VERSION}, catalog=${metadata.catalogThree}, installed=${metadata.installedThree}`,
    );
  }
  if (metadata.outputSha256 !== sha256(bundle)) {
    throw new GateError('Android asset hash does not match its fail-closed metadata.');
  }
  const sourcePath = join(workspace, metadata.entry || '');
  if (!existsSync(sourcePath) || metadata.sourceSha256 !== sha256(readFileSync(sourcePath))) {
    throw new GateError('Android asset does not match the current examples/native-smoke source.');
  }
  if (metadata.coreSourceSha256 !== sourceTreeSha256(join(workspace, 'packages', 'core', 'src'))) {
    throw new GateError('Android asset does not match the current @threenative/core source tree.');
  }
  for (const marker of [...REQUIRED_MARKERS, ...UNORDERED_REQUIRED_MARKERS]) {
    if (!bundle.includes(marker) || !metadata.markers?.includes(marker)) {
      throw new GateError(`Android asset is missing exact proof marker ${marker}.`);
    }
  }
  return metadata;
}

export function assertPackagedAndroidBundle(packagedBundle, metadata) {
  if (metadata.outputSha256 !== sha256(packagedBundle)) {
    throw new GateError('Android APK asset does not match its generated bundle metadata.');
  }
}

function verifyPackagedAndroidBundle(apk, metadata, javaHome) {
  const temporary = mkdtempSync(join(tmpdir(), 'threenative-apk-'));
  try {
    run(join(javaHome, 'bin', executableName('jar')), [
      '--extract',
      '--file',
      apk,
      'assets/scripts/main.js',
    ], { cwd: temporary });
    const packagedPath = join(temporary, 'assets', 'scripts', 'main.js');
    if (!existsSync(packagedPath)) throw new GateError('Android APK is missing assets/scripts/main.js.');
    assertPackagedAndroidBundle(readFileSync(packagedPath), metadata);
  } finally {
    rmSync(temporary, { force: true, recursive: true });
  }
}

function buildApk(tools, engine = null) {
  const androidDir = join(root, 'android');
  const gradleEnv = {
    ...process.env,
    JAVA_HOME: tools.javaHome,
    ANDROID_HOME: tools.sdkRoot,
    ANDROID_SDK_ROOT: tools.sdkRoot,
    PATH: `${join(tools.javaHome, 'bin')}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH || ''}`,
  };
  const command = process.platform === 'win32' ? join(androidDir, 'gradlew.bat') : 'bash';
  // A gate that asserts an engine has to build that engine, or it asserts against whatever the
  // default happens to be that week and the assertion is the only thing that fails.
  const engineArgs = engine ? [`-PthreenativeJsEngine=${engine}`] : [];
  const gradleArgs = [':app:assembleDebug', '--console=plain', ...engineArgs];
  const args = process.platform === 'win32'
    ? gradleArgs
    : [join(androidDir, 'gradlew'), ...gradleArgs];
  console.log(`1/4 Building Android debug APK with JDK 17${engine ? ` (${engine})` : ''}...`);
  const result = run(command, args, { cwd: androidDir, env: gradleEnv, timeoutMs: 900000 });
  if (result.stdout) process.stdout.write(result.stdout);
}

function buildFailureMessage(analysis, logPath) {
  if (analysis.failures.length) {
    const failure = analysis.failures[0];
    return `Android first proof failed: ${failure.kind} at captured log line ${failure.line}: ${failure.excerpt}\nFull log: ${logPath}`;
  }
  return `Android first proof timed out with missing exact markers: ${analysis.missingMarkers.join(', ')}.\nFull log: ${logPath}`;
}

export async function verifyAndroidFirstProof(options, dependencies = {}) {
  const tools = dependencies.tools || discoverTools(); const execute = dependencies.run || run; const verifyBundle = dependencies.verifyAndroidBundle || verifyAndroidBundle; const verifyPackage = dependencies.verifyPackagedAndroidBundle || verifyPackagedAndroidBundle; const prepare = dependencies.prepareAndroidEmulator || prepareAndroidEmulator;
  const now = dependencies.now || (() => new Date());
  const wait = dependencies.delay || delay;
  const startedAt = now();

  if (!options.skipBuild) buildApk(tools, options.expectEngine);
  else console.log(`1/4 Reusing Android debug APK ${options.apk}...`);
  if (!existsSync(options.apk)) {
    throw new GateError(`Debug APK not found at ${options.apk}. Remove --skip-build so the gate builds it.`);
  }
  const bundleMetadata = verifyBundle();
  verifyPackage(options.apk, bundleMetadata, tools.javaHome);

  const devicesOutput = execute(tools.adb, ['devices', '-l'], { timeoutMs: 10000 }).stdout;
  const serial = selectDevice(parseAdbDevices(String(devicesOutput)), options.device);
  const common = (...args) => execute(tools.adb, adbArgs(serial, ...args), { timeoutMs: 120000 }); const devicePreparation = prepare(serial, (...args) => common(...args));

  console.log(`2/4 Targeting Android device ${serial}...`);
  if (!options.skipInstall) {
    const install = common('install', '-r', '-t', options.apk);
    if (!/Success/i.test(String(install.stdout))) {
      throw new GateError(`adb install did not report Success:\n${String(install.stdout || install.stderr).trim()}`);
    }
  }

  common('shell', 'am', 'force-stop', APP_ID);
  common('logcat', '-c');
  console.log('3/4 Launching the first proof and waiting for its exact ready marker...');
  const launch = common('shell', 'am', 'start', '-W', '-n', ACTIVITY);
  if (!/Status:\s*ok/i.test(String(launch.stdout))) {
    throw new GateError(`Android activity did not start successfully:\n${String(launch.stdout || launch.stderr).trim()}`);
  }

  let pid = null;
  let rawLog = '';
  let appLog = '';
  let analysis = { markerFound: false, missingMarkers: [...REQUIRED_MARKERS], failures: [] };
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() <= deadline) {
    pid ||= getPid(tools.adb, serial, execute);
    rawLog = captureLog(tools.adb, serial, execute);
    appLog = filterAppLog(rawLog, pid);
    analysis = analyzeAppLog(appLog);
    writeText(options.logPath, appLog.endsWith('\n') ? appLog : `${appLog}\n`);
    if (analysis.failures.length) throw new GateError(buildFailureMessage(analysis, options.logPath), { analysis });
    if (analysis.markerFound) break;
    if (pid && !getPid(tools.adb, serial, execute)) {
      throw new GateError(`Android process ${APP_ID} exited before success. Full log: ${options.logPath}`);
    }
    await wait(500);
  }

  if (!analysis.markerFound) throw new GateError(buildFailureMessage(analysis, options.logPath), { analysis });
  if (!pid || !getPid(tools.adb, serial, execute)) {
    throw new GateError(`Success marker appeared, but Android process ${APP_ID} is no longer alive. Full log: ${options.logPath}`);
  }

  if (options.settleMs > 0) await wait(options.settleMs);
  rawLog = captureLog(tools.adb, serial, execute);
  appLog = filterAppLog(rawLog, pid);
  // The app has reported 300 frames by now, so it has emitted five present ticks. A log with none
  // is a gate that measured nothing, which is the failure this repository treats as the dangerous
  // one -- green while asserting something other than what it claims.
  analysis = analyzeAppLog(appLog, { requireTicks: true });
  writeText(options.logPath, appLog.endsWith('\n') ? appLog : `${appLog}\n`);
  if (analysis.failures.length) throw new GateError(buildFailureMessage(analysis, options.logPath), { analysis });
  // Before the screenshot, so a mismatched engine fails on the engine rather than on whatever the
  // wrong build happened to draw.
  const engineCheck = assertEngine(appLog, options.expectEngine);
  if (!getPid(tools.adb, serial, execute)) {
    throw new GateError(`Android process ${APP_ID} exited during the ${options.settleMs} ms stability window. Full log: ${options.logPath}`);
  }

  if (!options.screenshotPath) throw new GateError('Android proof requires a screenshot path.');
  const png = execute(tools.adb, adbArgs(serial, 'exec-out', 'screencap', '-p'), { binary: true, timeoutMs: 30000 }).stdout;
  const dimensions = inspectScreenshot(png);
  mkdirSync(dirname(options.screenshotPath), { recursive: true });
  writeFileSync(options.screenshotPath, png);
  // The blank check above passes on a half-drawn frame, which is how the overlay defect survived
  // every native gate. Nothing in the smoke world is magenta and nothing else draws into the
  // canvas layer, so these pixels exist only if the second render pass reached the display.
  const overlay = inspectOverlayBuffer(png, { label: options.screenshotPath });
  const displaySize = String(common('shell', 'wm', 'size').stdout).trim();
  const displayDensity = String(common('shell', 'wm', 'density').stdout).trim();
  const screenshot = {
    path: options.screenshotPath,
    bytes: png.length,
    sha256: sha256(png),
    ...dimensions,
    ...overlay,
    displaySize,
    displayDensity,
  };
  const presentTicks = analyzePresentTicks(appLog).ticks;

  const finishedAt = now();
  const report = {
    schemaVersion: 1,
    passed: true,
    markers: REQUIRED_MARKERS,
    frames: 300,
    threeVersion: EXPECTED_THREE_VERSION,
    bundle: {
      entry: bundleMetadata.entry,
      outputSha256: bundleMetadata.outputSha256,
      publicApiPackage: bundleMetadata.publicApiPackage,
    },
    appId: APP_ID,
    activity: ACTIVITY,
    // Recorded unconditionally, whether or not this run asked for a particular engine. A device
    // report that does not say which engine produced it cannot be compared with another one.
    jsEngine: engineCheck.engine,
    jsEngineExpected: engineCheck.expected,
    deviceSerial: serial, devicePreparation,
    pid,
    apk: options.apk,
    apkBytes: statSync(options.apk).size,
    logcat: options.logPath,
    presents: {
      lastFrames: presentTicks.at(-1)?.frames ?? null,
      lastPresents: presentTicks.at(-1)?.presents ?? null,
      ticks: presentTicks.length,
    },
    screenshot,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    stabilityWindowMs: options.settleMs,
    steps: {
      build: options.skipBuild ? 'reused' : 'passed',
      install: options.skipInstall ? 'reused' : 'passed',
      launch: 'passed',
      marker: 'passed',
      processAlive: 'passed',
      logScan: 'passed',
      overlay: 'passed',
      presentInvariant: 'passed',
      screenshot: 'captured',
    },
    tools: {
      adb: tools.adb,
      androidSdk: tools.sdkRoot,
      javaHome: tools.javaHome,
      javaMajor: javaMajorFromRelease(tools.javaHome),
      wgpuRootOverride: process.env.THREENATIVE_WGPU_ROOT || null,
    },
  };
  writeText(options.reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`4/4 PASS: ${report.frames} frames, clean logs, screenshot captured, and process ${pid} remained alive for ${options.settleMs} ms.`);
  console.log(JSON.stringify({ report: options.reportPath, logcat: options.logPath, screenshot }, null, 2));
  return report;
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(usage());
      return;
    }
    await verifyAndroidFirstProof(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`FAIL: ${message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

export const APP_ID = 'com.mystral.engine';
export const ACTIVITY = `${APP_ID}/.MystralActivity`;
export const SUCCESS_MARKER = '[ThreeNative Android] first proof cube ready';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultApk = join(root, 'android/app/build/outputs/apk/debug/app-debug.apk');
const defaultLogPath = join(root, 'artifacts/android/first-proof-logcat.txt');
const defaultReportPath = join(root, 'artifacts/android/first-proof-report.json');

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
  --screenshot PATH     Optionally capture a PNG and record its dimensions/hash
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
    screenshotPath: null,
    skipBuild: false,
    skipInstall: false,
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
  { kind: 'fatal-signal', pattern: /\bFatal signal\b|\bSIG(?:ABRT|BUS|FPE|ILL|SEGV|TRAP)\b/i },
  { kind: 'range-error', pattern: /\bRangeError\b/i },
  { kind: 'webgpu-error', pattern: /(?:WebGPU|wgpu(?:-native)?|GPUValidationError)[^\r\n]{0,180}\b(?:error|failed|failure|invalid|validation)\b/i },
  { kind: 'webgpu-error', pattern: /\b(?:error|failed|failure|invalid|validation)\b[^\r\n]{0,180}(?:WebGPU|wgpu(?:-native)?|GPUValidationError)/i },
  { kind: 'shader-error', pattern: /Device::create_shader_module error|Shader parsing error/i },
];

export function filterAppLog(log, pid) {
  if (!pid) return log;
  const pidPattern = new RegExp(`^\\S+\\s+\\S+\\s+${pid}\\s+\\d+\\s+[VDIWEF]\\s`, 'm');
  return log.split(/\r?\n/).filter((line) => {
    return line.includes(APP_ID) || line.includes(SUCCESS_MARKER) || pidPattern.test(line);
  }).join('\n');
}

export function analyzeAppLog(log) {
  const failures = [];
  for (const matcher of failureMatchers) {
    const match = log.match(matcher.pattern);
    if (match) {
      const line = log.slice(0, match.index).split(/\r?\n/).length;
      failures.push({ kind: matcher.kind, line, excerpt: log.split(/\r?\n/)[line - 1]?.trim() || match[0] });
    }
  }
  return {
    markerFound: log.includes(SUCCESS_MARKER),
    failures,
  };
}

function adbArgs(serial, ...args) {
  return ['-s', serial, ...args];
}

function getPid(adb, serial) {
  const result = run(adb, adbArgs(serial, 'shell', 'pidof', APP_ID), { allowFailure: true, timeoutMs: 10000 });
  if (result.status !== 0) return null;
  return String(result.stdout).trim().split(/\s+/).find(Boolean) || null;
}

function captureLog(adb, serial) {
  const result = run(adb, adbArgs(serial, 'logcat', '-d', '-v', 'threadtime'), { timeoutMs: 15000 });
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

function writeText(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function buildApk(tools) {
  const androidDir = join(root, 'android');
  const gradleEnv = {
    ...process.env,
    JAVA_HOME: tools.javaHome,
    ANDROID_HOME: tools.sdkRoot,
    ANDROID_SDK_ROOT: tools.sdkRoot,
    PATH: `${join(tools.javaHome, 'bin')}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH || ''}`,
  };
  const command = process.platform === 'win32' ? join(androidDir, 'gradlew.bat') : 'bash';
  const args = process.platform === 'win32'
    ? [':app:assembleDebug', '--console=plain']
    : [join(androidDir, 'gradlew'), ':app:assembleDebug', '--console=plain'];
  console.log('1/4 Building Android debug APK with JDK 17...');
  const result = run(command, args, { cwd: androidDir, env: gradleEnv, timeoutMs: 900000 });
  if (result.stdout) process.stdout.write(result.stdout);
}

function buildFailureMessage(analysis, logPath) {
  if (analysis.failures.length) {
    const failure = analysis.failures[0];
    return `Android first proof failed: ${failure.kind} at captured log line ${failure.line}: ${failure.excerpt}\nFull log: ${logPath}`;
  }
  return `Android first proof timed out before the exact success marker ${JSON.stringify(SUCCESS_MARKER)}.\nFull log: ${logPath}`;
}

export async function verifyAndroidFirstProof(options, dependencies = {}) {
  const tools = dependencies.tools || discoverTools();
  const now = dependencies.now || (() => new Date());
  const wait = dependencies.delay || delay;
  const startedAt = now();

  if (!options.skipBuild) buildApk(tools);
  else console.log(`1/4 Reusing Android debug APK ${options.apk}...`);
  if (!existsSync(options.apk)) {
    throw new GateError(`Debug APK not found at ${options.apk}. Remove --skip-build so the gate builds it.`);
  }

  const devicesOutput = run(tools.adb, ['devices', '-l'], { timeoutMs: 10000 }).stdout;
  const serial = selectDevice(parseAdbDevices(String(devicesOutput)), options.device);
  const common = (...args) => run(tools.adb, adbArgs(serial, ...args), { timeoutMs: 120000 });

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
  let analysis = { markerFound: false, failures: [] };
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() <= deadline) {
    pid ||= getPid(tools.adb, serial);
    rawLog = captureLog(tools.adb, serial);
    appLog = filterAppLog(rawLog, pid);
    analysis = analyzeAppLog(appLog);
    writeText(options.logPath, appLog.endsWith('\n') ? appLog : `${appLog}\n`);
    if (analysis.failures.length) throw new GateError(buildFailureMessage(analysis, options.logPath), { analysis });
    if (analysis.markerFound) break;
    if (pid && !getPid(tools.adb, serial)) {
      throw new GateError(`Android process ${APP_ID} exited before success. Full log: ${options.logPath}`);
    }
    await wait(500);
  }

  if (!analysis.markerFound) throw new GateError(buildFailureMessage(analysis, options.logPath), { analysis });
  if (!pid || !getPid(tools.adb, serial)) {
    throw new GateError(`Success marker appeared, but Android process ${APP_ID} is no longer alive. Full log: ${options.logPath}`);
  }

  if (options.settleMs > 0) await wait(options.settleMs);
  rawLog = captureLog(tools.adb, serial);
  appLog = filterAppLog(rawLog, pid);
  analysis = analyzeAppLog(appLog);
  writeText(options.logPath, appLog.endsWith('\n') ? appLog : `${appLog}\n`);
  if (analysis.failures.length) throw new GateError(buildFailureMessage(analysis, options.logPath), { analysis });
  if (!getPid(tools.adb, serial)) {
    throw new GateError(`Android process ${APP_ID} exited during the ${options.settleMs} ms stability window. Full log: ${options.logPath}`);
  }

  let screenshot = null;
  if (options.screenshotPath) {
    const png = run(tools.adb, adbArgs(serial, 'exec-out', 'screencap', '-p'), { binary: true, timeoutMs: 30000 }).stdout;
    const dimensions = pngDimensions(png);
    mkdirSync(dirname(options.screenshotPath), { recursive: true });
    writeFileSync(options.screenshotPath, png);
    const displaySize = String(common('shell', 'wm', 'size').stdout).trim();
    const displayDensity = String(common('shell', 'wm', 'density').stdout).trim();
    screenshot = {
      path: options.screenshotPath,
      bytes: png.length,
      sha256: createHash('sha256').update(png).digest('hex'),
      ...dimensions,
      displaySize,
      displayDensity,
    };
  }

  const finishedAt = now();
  const report = {
    schemaVersion: 1,
    passed: true,
    marker: SUCCESS_MARKER,
    appId: APP_ID,
    activity: ACTIVITY,
    deviceSerial: serial,
    pid,
    apk: options.apk,
    apkBytes: statSync(options.apk).size,
    logcat: options.logPath,
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
      screenshot: screenshot ? 'captured' : 'not-requested',
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
  console.log(`4/4 PASS: marker found and process ${pid} remained alive for ${options.settleMs} ms.`);
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

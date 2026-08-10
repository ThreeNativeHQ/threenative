#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  parseArgs as parseFirstProofArgs,
  verifyAndroidFirstProof,
} from './verify-android-first-proof.mjs';

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = resolve(runtimeRoot, '..', '..');
const artifactRoot = join(runtimeRoot, 'artifacts', 'android', 'multitouch');
const reportPath = join(artifactRoot, 'report.json');

function usage() {
  return `Usage: node scripts/verify-android-multitouch.mjs [options]

Runs the native-smoke multi-touch scenario and its one-pointer negative control on an emulator.

Options:
  --device SERIAL  target emulator (for example emulator-5556)
  --skip-build     reuse the existing debug APK
  --skip-install   reuse the installed APK
  --help           print this help
`;
}

export function parseArgs(argv) {
  const options = { device: null, help: false, skipBuild: false, skipInstall: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--device') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error('--device requires an emulator serial.');
      options.device = value;
    } else if (arg === '--skip-build') options.skipBuild = true;
    else if (arg === '--skip-install') options.skipInstall = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown option ${arg}. Run with --help.`);
  }
  if (options.device && !options.device.startsWith('emulator-')) {
    throw new Error('TN_MULTITOUCH_EMULATOR_REQUIRED: protocol-B injection requires an emulator-* serial.');
  }
  return options;
}

class ReportingAndroidDriver {
  constructor(driver) {
    this.driver = driver;
    this.injections = [];
    this.livenessChecks = [];
  }
  captureConsole() { return this.driver.captureConsole(); }
  prepare(endpoint, mailboxRoot) { return this.driver.prepare(endpoint, mailboxRoot); }
  readFile(path) { return this.driver.readFile(path); }
  removeFile(path) { return this.driver.removeFile(path); }
  screenshot(path) { return this.driver.screenshot(path); }
  stop() { return this.driver.stop(); }
  writeFile(path, contents) { return this.driver.writeFile(path, contents); }
  async isAlive() {
    const alive = await this.driver.isAlive();
    this.livenessChecks.push(alive);
    return alive;
  }
  async setPointers(pointers) {
    const result = await this.driver.setPointers(pointers);
    this.injections.push({ requestedIds: pointers.map(({ id }) => id), ...result });
    return result;
  }
}

function playtestConfig({ adbPath, device, endpoint, scenarioPath, artifactDirectory }) {
  return {
    adbPath,
    android: { activity: '.MystralActivity', packageName: 'com.mystral.engine' },
    artifactDirectory,
    device,
    endpoint,
    headless: true,
    projectPath: join(workspace, 'examples', 'native-smoke'),
    scenarioPath,
    target: 'android',
    timeoutMs: 30_000,
    trace: false,
    url: 'http://127.0.0.1:5173',
  };
}

function stateAfter(report) {
  return report.observations?.resources?.GameState?.after ?? {};
}

export function validateResults(positive, negative) {
  if (!positive.pass) throw new Error('Positive multi-touch scenario failed its assertions.');
  if (positive.assertionResults?.some(({ pass }) => !pass) !== false) {
    throw new Error('Positive multi-touch scenario did not evaluate a complete passing assertion set.');
  }
  if (negative.pass || negative.assertionResults === undefined) {
    throw new Error('One-pointer negative control must reach assertions and fail with exit-code-1 semantics.');
  }
  const state = stateAfter(positive);
  for (const [key, expected] of [
    ['maxPointers', 2],
    ['movedWithTwoPointers', true],
    ['leftGroundWithTwoPointers', true],
    ['currentPointers', 0],
  ]) {
    if (state[key] !== expected) throw new Error(`Positive proof state ${key}=${state[key]} did not equal ${expected}.`);
  }
  return state;
}

export async function verifyAndroidMultitouch(options) {
  mkdirSync(artifactRoot, { recursive: true });
  const firstProofArgs = [
    ...(options.device ? ['--device', options.device] : []),
    ...(options.skipBuild ? ['--skip-build'] : []),
    ...(options.skipInstall ? ['--skip-install'] : []),
    '--settle-ms', '0',
    '--logcat', join(artifactRoot, 'first-proof-logcat.txt'),
    '--report', join(artifactRoot, 'first-proof-report.json'),
    '--screenshot', join(artifactRoot, 'first-proof.png'),
  ];
  const firstProof = await verifyAndroidFirstProof(parseFirstProofArgs(firstProofArgs));
  const { AdbAndroidDriver, runAndroidPlaytest } = await import(
    '../../playtest/dist/runner/index.js'
  );
  const drivers = [];
  try {
    const positiveDriver = new ReportingAndroidDriver(new AdbAndroidDriver({
      activity: '.MystralActivity',
      adbPath: firstProof.tools.adb,
      packageName: 'com.mystral.engine',
      serial: firstProof.deviceSerial,
    }));
    drivers.push(positiveDriver);
    const positive = await runAndroidPlaytest(playtestConfig({
      adbPath: firstProof.tools.adb,
      artifactDirectory: join(artifactRoot, 'positive'),
      device: firstProof.deviceSerial,
      endpoint: 'http://127.0.0.1:41777/playtest',
      scenarioPath: 'playtests/multitouch.playtest.json',
    }), { driver: positiveDriver });

    const negativeDriver = new ReportingAndroidDriver(new AdbAndroidDriver({
      activity: '.MystralActivity',
      adbPath: firstProof.tools.adb,
      packageName: 'com.mystral.engine',
      serial: firstProof.deviceSerial,
    }));
    drivers.push(negativeDriver);
    const negative = await runAndroidPlaytest(playtestConfig({
      adbPath: firstProof.tools.adb,
      artifactDirectory: join(artifactRoot, 'negative'),
      device: firstProof.deviceSerial,
      endpoint: 'http://127.0.0.1:41778/playtest',
      scenarioPath: 'playtests/multitouch-one-pointer-negative.playtest.json',
    }), { driver: negativeDriver });
    const latches = validateResults(positive, negative);
    const report = {
      schemaVersion: 1,
      passed: true,
      deviceSerial: firstProof.deviceSerial,
      bundle: firstProof.bundle,
      injection: {
        kind: 'adb-emu-event-protocol-b',
        positive: positiveDriver.injections,
        negative: negativeDriver.injections,
      },
      latches,
      liveness: {
        firstProof: firstProof.steps.processAlive,
        positive: positiveDriver.livenessChecks,
        negative: negativeDriver.livenessChecks,
      },
      assertions: positive.assertionResults,
      negativeControl: {
        assertionResults: negative.assertionResults,
        exitCode: 1,
        pass: negative.pass,
      },
    };
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    return report;
  } finally {
    await Promise.all(drivers.map((driver) => driver.setPointers([]).catch(() => undefined)));
  }
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) return process.stdout.write(usage());
    const report = await verifyAndroidMultitouch(options);
    process.stdout.write(`${JSON.stringify({ pass: true, report: reportPath, latches: report.latches }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

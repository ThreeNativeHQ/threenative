#!/usr/bin/env node
// PRD-225 phase 1' — the relaunch guard. Answers "does physics still crash on cold launch"
// mechanically instead of depending on whoever noticed last time: N fresh cold launches of an
// installed game APK, each watched through a gameplay window for tombstone-grade deaths.
//
// Phase 0's probe (2026-08-27, emulator-5554) ran this protocol by hand and found zero deaths
// in 10 launches; this script is that loop, kept, so the next session re-runs one command
// instead of re-deriving it. Fail closed: any launch whose app dies, any crash signature in the
// launch's logcat, or an app that never produced frame-budget windows is a failed launch, and
// any failed launch fails the script.
//
// Usage:
//   node scripts/device-physics-stability.mjs --apk <apk> --package <id> [--activity <fqcn>]
//        [--launches 10] [--window-seconds 62] [--serial <device>] [--quiet]
//
// Platform scope is part of the result: record which serial ran. A green on the emulator does
// not retire a physical-device observation — it names its own lane.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAdbClient } from './lib/adb.mjs';
import {
  suppressPlayProtectOnAdbInstalls,
  verifyInstalledPackage,
} from './lib/device.mjs';

function parseArgs(argv) {
  const args = { launches: 10, windowSeconds: 62, quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case '--apk': args.apk = argv[++i]; break;
      case '--package': args.package = argv[++i]; break;
      case '--activity': args.activity = argv[++i]; break;
      case '--launches': args.launches = Number(argv[++i]); break;
      case '--window-seconds': args.windowSeconds = Number(argv[++i]); break;
      case '--serial': args.serial = argv[++i]; break;
      case '--quiet': args.quiet = true; break;
      default:
        console.error(`unknown flag ${argv[i]}`);
        process.exit(64);
    }
  }
  if (!args.apk || !args.package) {
    console.error('usage: --apk <apk> --package <id> [--activity <fqcn>] [--launches N] [--window-seconds S] [--serial dev]');
    process.exit(64);
  }
  return args;
}

const CRASH_PATTERN = /FATAL EXCEPTION|Fatal signal|SIGSEGV|SIGABRT|SIGBUS|SIGTRAP|>>> .* <<</u;
// The crash-policy info line legitimately contains the word "tombstone"; it is not a death.
const BENIGN_PATTERN = /debuggerd owns the tombstone/u;

const say = (quiet, message) => {
  if (!quiet) console.log(message);
};

export function createPhysicsStabilityDevice(serial, dependencies = {}) {
  const { THREENATIVE_ADB_SERIAL: _ignoredSerial, ...environment } =
    dependencies.environment ?? process.env;
  const execute = dependencies.execFileSyncImpl ?? execFileSync;
  const client = createAdbClient(serial, {
    allowDefaultTransport: serial == null,
    commandImpl: (executable, args, options) => ({
      status: 0,
      stderr: '',
      stdout: execute(executable, args, {
        encoding: 'utf8',
        maxBuffer: options.maxBuffer,
        timeout: options.timeout,
      }),
    }),
    environment,
    executable: 'adb',
    maxBuffer: 1024 * 1024,
    timeoutMs: 120_000,
  });
  return client;
}

export function preparePhysicsStabilityInstall(args, device) {
  suppressPlayProtectOnAdbInstalls(args.serial, {
    adb: (adbArgs) => device.command(adbArgs),
  });
  try {
    device.command(['uninstall', args.package]);
  } catch {
    // Not installed yet is fine; a fresh install is the point.
  }
  device.command(['install', args.apk]);
  try {
    verifyInstalledPackage((adbArgs) => device.command(adbArgs), args.package);
  } catch (error) {
    if (error?.code !== 'TN_DEVICE_INSTALL_MISSING') throw error;
    const observed = error?.details?.observed ?? '';
    throw new Error(`install did not land: pm path ${args.package} returned '${observed}'`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const scratch = mkdtempSync(join(tmpdir(), 'threenative-physics-stability-'));
  const device = createPhysicsStabilityDevice(args.serial);
  const launches = [];
  let failed = 0;

  // The Play Protect verifier dialog is a modal that eats injected touches, so ten unattended
  // launches behind it prove nothing. Suppress before the install, as every other install lane does.
  say(args.quiet, `fresh install of ${args.apk}`);
  preparePhysicsStabilityInstall(args, device);

  const activity = args.activity ?? `${args.package}/com.threenative.runtime.MystralActivity`;
  for (let index = 1; index <= args.launches; index += 1) {
    device.command(['logcat', '-c']);
    device.command(['shell', 'am', 'start', '-W', '-n', activity]);
    execFileSync('sleep', [String(args.windowSeconds)]);
    const log = device.command(['logcat', '-d']);
    writeFileSync(join(scratch, `launch-${index}.log`), log);
    const pid = device.command(['shell', 'pidof', args.package]).trim();
    const alive = pid.length > 0;
    const crashLines = log
      .split('\n')
      .filter((line) => CRASH_PATTERN.test(line) && !BENIGN_PATTERN.test(line));
    const budgetWindows = (log.match(/TN_FRAME_BUDGET/gu) ?? []).length;
    const played = budgetWindows > 0;
    const ok = alive && crashLines.length === 0 && played;
    if (!ok) failed += 1;
    launches.push({ index, alive, crashLines: crashLines.length, budgetWindows, ok });
    say(
      args.quiet,
      `launch ${index} | alive=${alive ? 'yes' : 'NO'} | crashLines=${crashLines.length}`
        + ` | budgetWindows=${budgetWindows} | ${ok ? 'ok' : 'FAILED'}`,
    );
    for (const line of crashLines) say(args.quiet, `  ${line}`);
    device.command(['shell', 'am', 'force-stop', args.package]);
    execFileSync('sleep', ['3']);
  }

  writeFileSync(
    join(scratch, 'probe.json'),
    `${JSON.stringify({ launches, apk: args.apk, package: args.package, activity }, null, 1)}\n`,
  );
  say(args.quiet, `records: ${scratch}`);
  if (failed > 0) {
    console.error(`physics stability: ${failed} of ${args.launches} launches failed`);
    process.exit(1);
  }
  console.log(`physics stability: ${args.launches}/${args.launches} launches clean`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

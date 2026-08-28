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
import { suppressPlayProtectOnAdbInstalls } from './device-preflight.mjs';

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

function adb(args, options = {}) {
  const argv = [];
  if (options.serial) argv.push('-s', options.serial);
  return execFileSync('adb', [...argv, ...args], { encoding: 'utf8', timeout: 120_000 });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const scratch = mkdtempSync(join(tmpdir(), 'threenative-physics-stability-'));
  const launches = [];
  let failed = 0;

  // The Play Protect verifier dialog is a modal that eats injected touches, so ten unattended
  // launches behind it prove nothing. Suppress before the install, as every other install lane does.
  suppressPlayProtectOnAdbInstalls(args.serial, {
    adb: (adbArgs) => adb(adbArgs, { serial: args.serial }),
  });

  say(args.quiet, `fresh install of ${args.apk}`);
  try {
    adb(['uninstall', args.package], { serial: args.serial });
  } catch {
    // Not installed yet is fine; a fresh install is the point.
  }
  adb(['install', args.apk], { serial: args.serial });
  // adb install can exit 0 while failing (a missing APK file only prints); verify the package
  // actually landed before trusting ten launches to it.
  const installedPath = adb(['shell', 'pm', 'path', args.package], { serial: args.serial }).trim();
  if (!installedPath.startsWith('package:')) {
    throw new Error(`install did not land: pm path ${args.package} returned '${installedPath}'`);
  }

  const activity = args.activity ?? `${args.package}/com.threenative.runtime.MystralActivity`;
  for (let index = 1; index <= args.launches; index += 1) {
    adb(['logcat', '-c'], { serial: args.serial });
    adb(['shell', 'am', 'start', '-W', '-n', activity], { serial: args.serial });
    execFileSync('sleep', [String(args.windowSeconds)]);
    const log = adb(['logcat', '-d'], { serial: args.serial });
    writeFileSync(join(scratch, `launch-${index}.log`), log);
    const pid = adb(['shell', 'pidof', args.package], { serial: args.serial }).trim();
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
    adb(['shell', 'am', 'force-stop', args.package], { serial: args.serial });
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

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

#!/usr/bin/env node

// PRD-222 Phase 3 — capture host memory before pause, after background pressure, and after resume.
// The script deliberately records the lifecycle markers emitted by the runtime alongside Android
// meminfo so a zero RSS delta is visible instead of being mistaken for an unmeasured trim.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function parseArgs(argv) {
  const options = { backgroundMs: 10 * 60 * 1000, warmMs: 15 * 1000 };
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--serial") options.serial = argv[++index];
    else if (key === "--package") options.packageName = argv[++index];
    else if (key === "--background-ms") options.backgroundMs = Number(argv[++index]);
    else if (key === "--warm-ms") options.warmMs = Number(argv[++index]);
    else if (key === "--out") options.out = argv[++index];
    else throw new Error(`unknown argument ${key}`);
  }
  if (!options.serial || !options.packageName) {
    throw new Error("--serial and --package are required");
  }
  if (!Number.isSafeInteger(options.backgroundMs) || options.backgroundMs < 0) {
    throw new Error("--background-ms must be a non-negative integer");
  }
  if (!Number.isSafeInteger(options.warmMs) || options.warmMs < 0) {
    throw new Error("--warm-ms must be a non-negative integer");
  }
  return options;
}

class Adb {
  constructor(serial) {
    this.serial = serial;
  }

  run(...args) {
    return execFileSync("adb", ["-s", this.serial, ...args], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  }

  shell(...args) {
    return this.run("shell", ...args).trim();
  }
}

function parseMeminfo(text) {
  const readKb = (label) => {
    const match = text.match(new RegExp(`${label}\\s*:\\s*([\\d,]+)`, "u"));
    return match ? Number(match[1].replaceAll(",", "")) : null;
  };
  return {
    totalPssKb: readKb("TOTAL PSS"),
    totalRssKb: readKb("TOTAL RSS"),
    gpuLines: text
      .split(/\r?\n/u)
      .filter((line) => /GL mtrack|EGL mtrack|Gfx dev|Memtrack/u.test(line)),
  };
}

function processId(adb, packageName) {
  const value = adb.shell("pidof", packageName);
  return value === "" ? null : value.split(/\s+/u)[0];
}

function memory(adb, packageName) {
  return parseMeminfo(adb.shell("dumpsys", "meminfo", packageName));
}

function markers(adb) {
  return adb
    .run("logcat", "-d", "-v", "threadtime")
    .split(/\r?\n/u)
    .filter((line) =>
      /TN_LIFECYCLE_MEMORY_TRIM|TN_LIFECYCLE_MEMORY_TRIM_CALLBACK|TN_PRESENTS_TICK/u.test(line),
    );
}

async function main() {
  const options = parseArgs(process.argv);
  const adb = new Adb(options.serial);
  const activity = `${options.packageName}/com.threenative.runtime.MystralActivity`;

  // ActivityManager keeps the last requested trim level for a process. Start a fresh process so
  // the forced pressure rung is repeatable after an earlier measurement used a higher level.
  adb.shell("am", "force-stop", options.packageName);
  adb.shell("am", "start", "-W", "-n", activity);
  await sleep(options.warmMs);
  adb.run("logcat", "-c");

  const before = {
    pid: processId(adb, options.packageName),
    memory: memory(adb, options.packageName),
  };

  adb.shell("input", "keyevent", "KEYCODE_HOME");
  await sleep(options.backgroundMs);
  const background = {
    pid: processId(adb, options.packageName),
    memory: memory(adb, options.packageName),
  };

  // TRIM_MEMORY_COMPLETE (80) is intentionally used for the forced pressure rung: the shell
  // command is a deterministic negative/positive control, while the runtime acts at MODERATE
  // (60) and above. Android may queue SDL's level-less event until the activity returns.
  adb.shell("am", "send-trim-memory", options.packageName, "80");
  await sleep(500);
  const afterTrimWhileBackgrounded = {
    pid: processId(adb, options.packageName),
    memory: memory(adb, options.packageName),
  };

  adb.shell("am", "start", "-n", activity);
  await sleep(2000);
  const afterResume = {
    pid: processId(adb, options.packageName),
    memory: memory(adb, options.packageName),
  };

  const report = {
    serial: options.serial,
    package: options.packageName,
    backgroundMs: options.backgroundMs,
    before,
    background,
    afterTrimWhileBackgrounded,
    afterResume,
    markers: markers(adb),
  };
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (options.out) {
    mkdirSync(dirname(options.out), { recursive: true });
    writeFileSync(options.out, output);
  }
  process.stdout.write(output);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

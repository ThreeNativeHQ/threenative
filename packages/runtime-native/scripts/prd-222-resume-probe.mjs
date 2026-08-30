// PRD-222 Phase 0 — reproduce "return from background reloads the game" and attribute it.
//
// Drives one installed native game through background/resume arms over adb, capturing for each:
// pid continuity, the full logcat slice, `dumpsys activity exit-info`, a screencap, and
// before/after meminfo. Attribution inputs are AmKill / lowmemorykiller lines, TN_LIFECYCLE*
// markers, TN_PRESENTS_TICK continuity and the exit-info reason.
//
// Arms (each independent: launch → play → perturb → restore → observe):
//   30s / 2min / 10min — HOME-background for that long, then foreground again (ambient K1).
//   fontscale          — change system font scale mid-play (uncovered config axis, K2), then restore.
//   lock               — screen off mid-play, wait, wake and unlock (K3 family).
//
// Usage:
//   node packages/runtime-native/scripts/prd-222-resume-probe.mjs \
//     --serial <serial> --package com.threenative.bayview --out <artifact-dir> [--arms 30s,fontscale]

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const out = { arms: ["30s", "2min", "10min", "fontscale", "lock"] };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === "--serial") out.serial = argv[++i];
    else if (key === "--package") out.package = argv[++i];
    else if (key === "--out") out.out = argv[++i];
    else if (key === "--arms") out.arms = argv[++i].split(",");
    else throw new Error(`unknown argument ${key}`);
  }
  if (!out.serial || !out.package || !out.out) {
    throw new Error("--serial, --package and --out are required");
  }
  return out;
}

const ARM_SECONDS = { "30s": 30, "2min": 120, "10min": 600 };

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
  shell(command) {
    return this.run("shell", command).trim();
  }
}

async function main() {
  const opts = parseArgs(process.argv);
  const adb = new Adb(opts.serial);
  const activity = `${opts.package}/com.threenative.runtime.MystralActivity`;
  mkdirSync(opts.out, { recursive: true });

  const summary = [];
  const stamp = () => new Date().toISOString();

  async function pid() {
    const out = adb.shell(`pidof ${opts.package}`);
    return out === "" ? null : out.split(/\s+/)[0];
  }

  async function foreground(tag) {
    // -W waits for launch to complete; if the process had died this is a cold start, which is
    // itself evidence — the exit-info dump after the arm names why it died.
    const launch = adb.shell(`am start -W -n ${activity}`);
    // Mid-play means past the first-use pipeline compilation plus texture upload — measured
    // 12–14 s on the phone but ~34 s on the emulator (PRD-218 context; TN_COLD_START evidence).
    // Perturbing inside the load attributes the wrong death, so wait until frames are actually
    // presenting rather than trusting a fixed delay.
    let presenting = false;
    for (let i = 0; i < 60 && !presenting; i += 1) {
      await sleep(2000);
      try {
        presenting = /TN_PRESENTS_TICK/.test(adb.run("logcat", "-d", "-v", "threadtime"));
      } catch {
        presenting = false;
      }
    }
    if (!presenting) {
      console.log(`[${stamp()}] ${tag} WARNING: no TN_PRESENTS_TICK after 120 s; proceeding`);
    }
    const currentPid = await pid();
    console.log(`[${stamp()}] ${tag} foregrounded pid=${currentPid}`);
    return { launch, pid: currentPid };
  }

  async function captureSlice(name) {
    writeFileSync(join(opts.out, `${name}-logcat.txt`), adb.run("logcat", "-d", "-v", "threadtime"));
    writeFileSync(
      join(opts.out, `${name}-exit-info.txt`),
      adb.shell(`dumpsys activity exit-info ${opts.package}`),
    );
    execFileSync("adb", [
      "-s",
      opts.serial,
      "shell",
      "screencap",
      "-p",
      "/data/local/tmp/prd222-shot.png",
    ]);
    adb.run("pull", "/data/local/tmp/prd222-shot.png", join(opts.out, `${name}-screen.png`));
  }

  async function meminfo() {
    const full = adb.shell(`dumpsys meminfo ${opts.package}`);
    const total = full.match(/TOTAL PSS:\s+(\d+)/);
    const gpu = full.match(/(GL | EGL|Gfx dev|Memtrack)[^\n]*/g);
    return { totalKb: total ? Number(total[1]) : null, gpuLines: gpu ?? [], full };
  }

  function presentsCount() {
    // Count presents ticks in the retained logcat slice; continuity across an arm is the
    // no-reload proof, a restart near zero is the reload signature.
    try {
      const log = adb.run("logcat", "-d", "-v", "threadtime");
      return [...log.matchAll(/TN_PRESENTS_TICK:\{"frames":(\d+)/g)].map((m) => Number(m[1]));
    } catch {
      return [];
    }
  }

  for (const arm of opts.arms) {
    console.log(`[${stamp()}] === arm ${arm} ===`);
    const record = { arm, startedAt: stamp() };

    const pre = await foreground(`${arm} pre`);
    record.pidBefore = pre.pid;
    if (!pre.pid) throw new Error(`arm ${arm}: process not alive after launch — cannot proceed`);
    record.memBefore = await meminfo();
    adb.run("logcat", "-c");

    if (arm in ARM_SECONDS) {
      adb.shell("input keyevent KEYCODE_HOME");
      await sleep(ARM_SECONDS[arm] * 1000);
      adb.shell(`am start -n ${activity}`);
    } else if (arm === "fontscale") {
      const baseline = adb.shell("settings get system font_scale");
      record.fontScaleBaseline = baseline;
      await sleep(1000);
      const raised = Number(baseline) >= 1.3 ? "1.0" : "1.3";
      record.fontScaleSetTo = raised;
      adb.shell(`settings put system font_scale ${raised}`);
      await sleep(8000); // config change propagates; recreate/exit happens inside this window
      adb.shell(`settings put system font_scale ${baseline}`);
      await sleep(6000);
      // Bring the game back whichever way the config change went.
      adb.shell(`am start -n ${activity}`);
    } else if (arm === "lock") {
      await sleep(2000);
      // A bare `input keyevent KEYCODE_POWER` injects down+up faster than the policy window, and
      // the UP wakes the device again (measured 2026-08-25: asleep 0.7 s, "WAKE_REASON_WAKE_KEY").
      // Press, verify the display really slept, retry up to three times.
      let slept = false;
      for (let attempt = 0; attempt < 3 && !slept; attempt += 1) {
        adb.shell("input keyevent KEYCODE_POWER");
        await sleep(2000);
        slept = /state=OFF|Display State.*OFF|mWakefulness=Asleep/i.test(
          adb.shell("dumpsys power"),
        );
        console.log(`[${stamp()}] lock attempt ${attempt}: slept=${slept}`);
      }
      if (!slept) throw new Error("device refused to sleep; lock arm invalid, aborting");
      record.screenOffConfirmedAt = stamp();
      await sleep(30000);
      adb.shell("input keyevent KEYCODE_WAKEUP");
      await sleep(1500);
      adb.shell("input swipe 540 1800 540 500 200"); // dismiss keyguard (no-PIN test device)
      await sleep(3000);
      adb.shell(`am start -n ${activity}`); // explicit foreground even if keyguard ate the swipe
    } else {
      throw new Error(`unknown arm ${arm}`);
    }

    await sleep(6000); // settle: resume path, surface revalidation, first frames
    record.pidAfter = await pid();
    record.alive = record.pidAfter !== null;
    record.pidStable = record.pidBefore !== null && record.pidBefore === record.pidAfter;
    record.presentsTicks = presentsCount();
    record.memAfter = await meminfo();
    await captureSlice(arm);
    record.finishedAt = stamp();

    summary.push({
      arm,
      pidBefore: record.pidBefore,
      pidAfter: record.pidAfter,
      pidStable: record.pidStable,
      presentsFirst: record.presentsTicks.at(0) ?? null,
      presentsLast: record.presentsTicks.at(-1) ?? null,
      memTotalBeforeKb: record.memBefore.totalKb,
      memTotalAfterKb: record.memAfter.totalKb,
      fontScaleBaseline: record.fontScaleBaseline,
    });
    console.log(JSON.stringify(summary.at(-1)));
  }

  writeFileSync(join(opts.out, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(`\nwrote ${join(opts.out, "summary.json")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

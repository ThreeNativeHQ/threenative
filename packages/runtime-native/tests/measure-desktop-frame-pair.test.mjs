import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

import { makeTempDirSync } from "../../../test-support/temp-dir.js";

import {
  buildLaunchPlan,
  median,
  parseFrameMarkers,
  runPair,
  summarizeArms,
} from "../scripts/measure-desktop-frame-pair.mjs";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const validLog = readFileSync(join(fixtures, "desktop-frame-pair-valid.txt"), "utf8");

test("frame parser fails closed on malformed, missing, and empty eligible markers", () => {
  assert.throws(
    () => parseFrameMarkers(readFileSync(join(fixtures, "desktop-frame-pair-malformed.txt"), "utf8")),
    /TN_DESKTOP_PAIR_MALFORMED_JSON/u,
  );
  assert.throws(() => parseFrameMarkers("ordinary output"), /TN_DESKTOP_PAIR_MARKER_MISSING/u);
  assert.throws(
    () => parseFrameMarkers(validLog.replaceAll('"frame":226', '"frame":225').replaceAll('"frame":227', '"frame":900')),
    /TN_DESKTOP_PAIR_ELIGIBLE_FRAMES_EMPTY/u,
  );
});

test("frame parser enforces submit and indexed-draw thresholds", () => {
  const tooFewSubmits = validLog
    .split("\n")
    .filter((line) => !(line.includes('"frame":226') && line.includes('"bindingNs":13')))
    .join("\n");
  assert.throws(() => parseFrameMarkers(tooFewSubmits), /TN_DESKTOP_PAIR_SUBMITS_TOO_FEW:frame=226/u);
  const exactlyOneHundredDraws = validLog.replaceAll('"drawIndexed":40', '"drawIndexed":33').replace(
    '"frame":226,"bindingNs":13,"calls":3,"threadCpuNs":120,"presentNs":0,"bridgeNs":36,"bridgeOverheadNs":15,"commands":{"drawIndexed":33}',
    '"frame":226,"bindingNs":13,"calls":3,"threadCpuNs":120,"presentNs":0,"bridgeNs":36,"bridgeOverheadNs":15,"commands":{"drawIndexed":34}',
  );
  assert.throws(
    () => parseFrameMarkers(exactlyOneHundredDraws),
    /TN_DESKTOP_PAIR_INDEXED_DRAWS_TOO_FEW:frame=226/u,
  );
});

test("frame parser reports per-frame and run medians for all registered terms", () => {
  const result = parseFrameMarkers(validLog);
  assert.equal(result.eligibleFrames, 2);
  assert.deepEqual(result.frames[0], {
    bridgeNs: 99,
    bridgeOverheadNs: 36,
    commandNs: 36,
    frame: 226,
    indexedDraws: 120,
    submits: 3,
    workNs: 320,
  });
  assert.deepEqual(result.mediansNs, {
    bridgeNs: 148.5,
    bridgeOverheadNs: 54,
    commandNs: 51,
    workNs: 480,
  });
  assert.equal(median([9, 1, 5]), 5);
  assert.equal(median([10, 2, 4, 8]), 6);
  assert.throws(() => median([]), /TN_DESKTOP_PAIR_MEDIAN_EMPTY/u);
});

test("F15 alternates arms and discards only global launches one and two", () => {
  const plan = buildLaunchPlan(3);
  assert.deepEqual(
    plan.map(({ arm, discarded, globalLaunch }) => ({ arm, discarded, globalLaunch })),
    [
      { arm: "control", discarded: true, globalLaunch: 1 },
      { arm: "candidate", discarded: true, globalLaunch: 2 },
      { arm: "control", discarded: false, globalLaunch: 3 },
      { arm: "candidate", discarded: false, globalLaunch: 4 },
      { arm: "control", discarded: false, globalLaunch: 5 },
      { arm: "candidate", discarded: false, globalLaunch: 6 },
    ],
  );
  const runs = plan.map((item, index) => ({
    ...item,
    mediansNs: item.discarded
      ? null
      : { bridgeNs: index, bridgeOverheadNs: index + 1, commandNs: index + 2, workNs: index + 3 },
  }));
  assert.deepEqual(summarizeArms(runs), {
    candidate: {
      mediansNs: { bridgeNs: 4, bridgeOverheadNs: 5, commandNs: 6, workNs: 7 },
      runs: 2,
    },
    control: {
      mediansNs: { bridgeNs: 3, bridgeOverheadNs: 4, commandNs: 5, workNs: 6 },
      runs: 2,
    },
  });
});

test("pair runner hashes immutable inputs, uses root Xvfb, and records every launch", () => {
  const temporaryDirectory = makeTempDirSync("desktop-frame-pair-");
  try {
    const control = join(temporaryDirectory, "control");
    const candidate = join(temporaryDirectory, "candidate");
    const bundle = join(temporaryDirectory, "bayview.js");
    const output = join(temporaryDirectory, "evidence");
    writeFileSync(control, "control-binary");
    writeFileSync(candidate, "candidate-binary");
    writeFileSync(bundle, "bayview-bundle");
    const commands = [];
    const report = runPair(
      { bundle, candidate, control, output, runs: 2 },
      {
        readLoad: () => "0.25 0.50 0.75 1/100 123",
        spawnSync: (command, args) => {
          commands.push([command, ...args]);
          const screenshotAt = args.indexOf("--screenshot") + 1;
          writeFileSync(args[screenshotAt], "png-evidence");
          return { signal: null, status: 0, stderr: "", stdout: validLog };
        },
      },
    );
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.runs.length, 4);
    assert.equal(report.runs[0].discarded, true);
    assert.equal(report.runs[1].discarded, true);
    assert.equal(report.runs[2].discarded, false);
    assert.equal(report.runs[3].discarded, false);
    assert.equal(report.arms.control.runs, 1);
    assert.equal(report.arms.candidate.runs, 1);
    assert.equal(new Set(report.runs.map((run) => run.hashes.bundle)).size, 1);
    assert.ok(commands.every((command) => command[0] === "sh"));
    assert.ok(commands.every((command) => command[1].endsWith("/scripts/xvfb.sh")));
    assert.ok(commands.every((command) => command.includes(bundle)));
    assert.ok(report.runs.every((run) => run.loadavg === "0.25 0.50 0.75 1/100 123"));
    assert.deepEqual(JSON.parse(readFileSync(join(output, "report.json"), "utf8")), report);
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

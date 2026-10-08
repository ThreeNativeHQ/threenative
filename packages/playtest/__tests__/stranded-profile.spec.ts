import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { makeTempDirSync } from "../../../test-support/temp-dir.js";

import { reclaimableProfileDirectories, removeStrandedProfiles } from "../src/runner/browserSession.js";

test("reclaims a profile when its process exits after the first cleanup snapshot", async () => {
  const root = makeTempDirSync("tn-profile-exit-");
  const profile = join(root, "playwright_chromiumdev_profile-exiting");
  mkdirSync(profile);
  if (process.platform === "win32") {
    expect(await removeStrandedProfiles([], root)).toEqual([]);
    expect(existsSync(profile)).toBe(true); // Windows has no ps cleanup lane.
    return;
  }
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "--", profile], { stdio: "ignore" });
  await once(child, "spawn");
  const exited = once(child, "exit");
  const stop = setTimeout(() => child.kill(), 100);
  try {
    expect(await removeStrandedProfiles([], root)).toEqual([profile]);
    expect(existsSync(profile)).toBe(false);
  } finally {
    clearTimeout(stop);
    child.kill();
    await exited;
  }
});

// The orphan gate failed on `playwright_chromiumdev_profile-*` surviving a signal teardown, with
// its own verdict: "no process holds these directories, so this is a real leak". Playwright removes
// the profile of a browser it closed, but that happens in its driver and the CLI exits as soon as
// the bounded teardown returns — deliberately, because a Chromium under a virtual display can sit
// in close() forever. So the runner reclaims what it stranded.
test("only profiles this run created, and that nothing still holds, are reclaimed", () => {
  const before = ["/tmp/suite/playwright_chromiumdev_profile-old"];
  const after = [
    "/tmp/suite/playwright_chromiumdev_profile-old",
    "/tmp/suite/playwright_chromiumdev_profile-mine",
    "/tmp/suite/playwright_chromiumdev_profile-sibling",
  ];
  // A sibling runner's browser is alive and names its profile in its command line.
  const processes = [
    "/usr/bin/node cli.js --scenario x",
    "/opt/chromium --user-data-dir=/tmp/suite/playwright_chromiumdev_profile-sibling --headless",
  ].join("\n");

  expect(reclaimableProfileDirectories(before, after, processes)).toEqual([
    "/tmp/suite/playwright_chromiumdev_profile-mine",
  ]);
});

test("a profile that predates the launch is never this run's to remove", () => {
  const existing = ["/tmp/suite/playwright_chromiumdev_profile-a"];
  expect(reclaimableProfileDirectories(existing, existing, "")).toEqual([]);
});

test("nothing is reclaimed when the run created nothing", () => {
  expect(reclaimableProfileDirectories([], [], "")).toEqual([]);
});

// Playwright makes two kinds of temporary directory with two different spellings:
// `playwright_chromiumdev_profile-*` for the browser profile and `playwright-artifacts-*` for
// traces and videos. Reclaiming only the underscore form left the artifacts directory behind, and
// the orphan gate reported that one on its own the very next run.
test("both playwright temporary directory spellings are reclaimable", () => {
  const before = ["/tmp/suite/tsx-1001"];
  const after = [
    "/tmp/suite/tsx-1001",
    "/tmp/suite/playwright-artifacts-OaWbFV",
    "/tmp/suite/playwright_chromiumdev_profile-izC2Lh",
  ];
  expect(reclaimableProfileDirectories(before, after, "")).toEqual([
    "/tmp/suite/playwright-artifacts-OaWbFV",
    "/tmp/suite/playwright_chromiumdev_profile-izC2Lh",
  ]);
});

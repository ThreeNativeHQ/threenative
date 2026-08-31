import { expect, test } from "vitest";

import { reclaimableProfileDirectories } from "../src/runner/browserSession.js";

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

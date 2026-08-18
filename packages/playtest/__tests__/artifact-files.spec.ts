import { makeTempDir } from "../../../test-support/temp-dir.js";
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";

import { writeObservationArtifacts } from "../src/runner/runner.js";

// A diagnostic that names a file the runner never writes sends the reader to an empty
// directory. A build hit exactly that: TN_PLAYTEST_CONSOLE_ERROR said to open console.json
// and the artifact directory held only after.png and capture.json, so the errors had to be
// reconstructed from provenance. See docs/verification/sweep-platformer-2026-08-16.md.
const directories: string[] = [];

async function artifactDirectory(): Promise<string> {
  const directory = await makeTempDir("tn-playtest-artifacts-");
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { force: true, recursive: true });
});

test("writes console.json when the run captured a console error", async () => {
  const directory = await artifactDirectory();

  const written = await writeObservationArtifacts(directory, undefined, {
    console: [{ source: "page-error", text: "Cannot read properties of undefined", type: "pageerror" }],
    network: [],
    runtimeTrace: { recentRuntimeErrors: [] },
  });

  expect(written).toContain("console.json");
  const body = JSON.parse(await readFile(join(directory, "console.json"), "utf8"));
  expect(body).toHaveLength(1);
  expect(body[0].text).toContain("Cannot read properties of undefined");
});

test("writes runtime-trace.json when a runtime error was published", async () => {
  const directory = await artifactDirectory();

  await writeObservationArtifacts(directory, undefined, {
    console: [],
    network: [],
    runtimeTrace: { recentRuntimeErrors: [{ code: "TN_GAME_BROKE" }], runtimeReadouts: [] },
  });

  const body = JSON.parse(await readFile(join(directory, "runtime-trace.json"), "utf8"));
  expect(body.recentRuntimeErrors).toHaveLength(1);
});

test("honours an explicit artifacts request even when the channel is empty", async () => {
  const directory = await artifactDirectory();

  const written = await writeObservationArtifacts(
    directory,
    { console: true, network: true, runtimeTrace: true },
    { console: [], network: [], runtimeTrace: { recentRuntimeErrors: [] } },
  );

  expect([...written].sort()).toEqual(["console.json", "network.json", "runtime-trace.json"]);
});

test("writes nothing when no channel has content and none was requested", async () => {
  const directory = await artifactDirectory();

  const written = await writeObservationArtifacts(directory, {}, {
    console: [],
    network: [],
    runtimeTrace: { recentRuntimeErrors: [] },
  });

  expect(written).toEqual([]);
  expect(await readdir(directory)).toEqual([]);
});

import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";

const processCleanupDirectories = new Set<string>();
let processCleanupRegistered = false;

/**
 * Tags every directory this suite run creates, so the leak guard can count its own and nothing
 * else. `/tmp` is shared: several agent lanes work this repository at once, and a guard that
 * counted every `/tmp/threenative-*` failed whenever a sibling created or removed one mid-run —
 * in both directions, which is what gave it away. Unset outside `scripts/run-test-suite.sh`,
 * where the old whole-directory count still applies.
 */
function runTag(): string {
  const tag = process.env.TN_TEST_TEMP_TAG;
  return tag === undefined || tag === "" ? "" : `${tag}-`;
}

/** Joins the OS temp directory, the caller's prefix and this run's tag. */
function taggedPrefix(prefix: string): string {
  return join(tmpdir(), `${prefix}${runTag()}`);
}

function registerProcessCleanup(directory: string): void {
  processCleanupDirectories.add(directory);
  if (processCleanupRegistered) return;
  processCleanupRegistered = true;
  process.once("exit", () => {
    for (const entry of processCleanupDirectories) {
      rmSync(entry, { force: true, recursive: true });
    }
  });
}

/** Creates a test directory and removes it when the current test finishes. */
export async function makeTempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(taggedPrefix(prefix));
  if (process.env.VITEST === "true") {
    try {
      onTestFinished(() => rm(directory, { force: true, recursive: true }));
      return directory;
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("inside a test")) {
        await rm(directory, { force: true, recursive: true });
        throw error;
      }
    }
  }
  registerProcessCleanup(directory);
  return directory;
}

/** Creates a test directory synchronously and removes it when the current test finishes. */
export function makeTempDirSync(prefix: string): string {
  return makeTempDirSyncAt(taggedPrefix(prefix));
}

/** Creates a test directory from an absolute prefix and registers its cleanup. */
export function makeTempDirSyncAt(prefix: string): string {
  const directory = mkdtempSync(prefix);
  if (process.env.VITEST === "true") {
    try {
      onTestFinished(() => rmSync(directory, { force: true, recursive: true }));
      return directory;
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("inside a test")) {
        rmSync(directory, { force: true, recursive: true });
        throw error;
      }
    }
  }
  registerProcessCleanup(directory);
  return directory;
}

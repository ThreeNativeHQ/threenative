import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";

const processCleanupDirectories = new Set<string>();
let processCleanupRegistered = false;

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
  const directory = await mkdtemp(join(tmpdir(), prefix));
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
  return makeTempDirSyncAt(join(tmpdir(), prefix));
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

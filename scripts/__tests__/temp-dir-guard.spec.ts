import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const tempCreatorPattern = /\bmkdtemp(?:Sync)?\s*\(/u;

const allowedProductionCreators = new Map<string, string>([
  ["packages/playtest/src/runner/android.ts", "Android mailbox staging is removed in finally."],
  ["packages/playtest/src/runner/ios.ts", "iOS device staging is removed in finally."],
  [
    "packages/playtest/src/runner/videoAnalysis.ts",
    "Video frames are removed by the analysis finally.",
  ],
  ["scripts/profile-starter.ts", "The production profile removes its root in finally."],
  ["scripts/sweep-proof.ts", "The production proof gate removes roots in finally."],
  ["scripts/template-baseline.ts", "The production baseline gate removes its root in finally."],
  ["scripts/verify-golden-path.ts", "The production golden-path gate removes roots in finally."],
  ["scripts/verify-one-template.ts", "The production template gate owns its cleanup."],
  [
    "scripts/verify-template-playtests.ts",
    "The production template playtest gate owns its cleanup.",
  ],
  [
    "scripts/verify-registry-install.ts",
    "The production registry probe removes its parent in finally.",
  ],
  ["scripts/visual-gate.ts", "The production visual gate removes its root in finally."],
]);

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(absolute)));
      continue;
    }
    const isTypeScript = entry.name.endsWith(".ts") || entry.name.endsWith(".tsx");
    const isRuntimeNativeTest =
      entry.name.endsWith(".mjs") &&
      (absolute.includes(`${path.sep}tests${path.sep}`) || entry.name.includes(".test."));
    if (isTypeScript || isRuntimeNativeTest) files.push(absolute);
  }
  return files;
}

async function unregisteredTempCreators(): Promise<string[]> {
  const files = [
    ...(await sourceFiles(path.join(repositoryRoot, "packages"))),
    ...(await sourceFiles(path.join(repositoryRoot, "scripts"))),
    path.join(repositoryRoot, "playwright.config.ts"),
  ];
  const offenders: string[] = [];
  for (const file of files) {
    const relative = path.relative(repositoryRoot, file).split(path.sep).join("/");
    if (relative === "test-support/temp-dir.ts" || allowedProductionCreators.has(relative))
      continue;
    if (tempCreatorPattern.test(await readFile(file, "utf8"))) offenders.push(relative);
  }
  return offenders.sort();
}

describe("temporary directory guard", () => {
  it("requires every test-owned temporary directory to register cleanup", async () => {
    const offenders = await unregisteredTempCreators();
    expect(offenders, "unregistered temporary directory creators").toEqual([]);
  });
});

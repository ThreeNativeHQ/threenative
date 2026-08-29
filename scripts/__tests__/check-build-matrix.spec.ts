import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../test-support/temp-dir.js";
import { buildMatrixErrors } from "../check-build-matrix.js";

/**
 * PRD-235 Phase 1. The build matrix is the machine-readable answer to "which build directory
 * does this test executable live in and why". These fixtures are tiny stand-ins for
 * `packages/runtime-native/` — the checker reads three files there, so a fixture writes the same
 * three into a temp root and the assertions are about the named failures the gate must produce.
 */
interface IMatrixConfiguration {
  cacheVariables: Record<string, string>;
  directory: string;
  owner: string;
  preset: string;
  runs: string[];
}

interface IMatrix {
  configurations: IMatrixConfiguration[];
  version: number;
}

const FIXTURE_CMAKE = [
  "cmake_minimum_required(VERSION 3.20)",
  "project(MystralNativeRuntime LANGUAGES C CXX)",
  'option(TN_ENABLE_COVERAGE "Instrument native targets for source-based coverage" OFF)',
  "add_executable(threenative-alpha-test EXCLUDE_FROM_ALL tests/alpha.cpp)",
  "add_executable(threenative-beta-test EXCLUDE_FROM_ALL tests/beta.cpp)",
].join("\n");

const FIXTURE_PRESETS = {
  configurePresets: [{ binaryDir: "${sourceDir}/build/tn-linux", name: "tn-linux" }],
  version: 6,
};

async function makeMatrixFixtureRoot(): Promise<string> {
  const root = await makeTempDir("threenative-build-matrix-");
  // The checker no-ops on fixture trees that carry no core package (the same signal the census
  // gate uses); the core package marks this fixture as a real-shaped tree.
  await mkdir(path.join(root, "packages", "core"), { recursive: true });
  await writeFile(path.join(root, "packages", "core", "package.json"), "{}");
  await mkdir(path.join(root, "packages", "runtime-native"), { recursive: true });
  return root;
}

async function fixtureRoot(options: {
  cmake: string;
  matrix: IMatrix;
  presets: unknown;
}): Promise<string> {
  const root = await makeMatrixFixtureRoot();
  const packageDir = path.join(root, "packages", "runtime-native");
  await writeFile(path.join(packageDir, "CMakeLists.txt"), options.cmake);
  await writeFile(
    path.join(packageDir, "CMakePresets.json"),
    JSON.stringify(options.presets, null, 2),
  );
  await writeFile(
    path.join(packageDir, "build-matrix.json"),
    JSON.stringify(options.matrix, null, 2),
  );
  return root;
}

/**
 * A case that names its own configurations is describing the whole matrix, so the override
 * replaces the default lane rather than extending it — and every fixture CMake target must be
 * claimed by one of them, or the unclaimed-target rule fires on top of the failure under test.
 */
function fixtureMatrix(overrides: Partial<IMatrix> = {}): IMatrix {
  return {
    configurations: [
      {
        cacheVariables: {},
        directory: "tn-linux",
        owner: "default contract lane",
        preset: "tn-linux",
        runs: ["threenative-alpha-test", "threenative-beta-test"],
      },
    ],
    version: 1,
    ...overrides,
  };
}

describe("build matrix gate", () => {
  it("should fail when a test target belongs to no configuration", async () => {
    const root = await fixtureRoot({
      cmake: `${FIXTURE_CMAKE}\nadd_executable(threenative-fresh-test EXCLUDE_FROM_ALL tests/fresh.cpp)`,
      matrix: fixtureMatrix(),
      presets: FIXTURE_PRESETS,
    });

    await expect(buildMatrixErrors(root)).resolves.toEqual([
      expect.stringContaining(
        "threenative-fresh-test is registered in CMakeLists.txt but no build-matrix configuration claims it",
      ),
    ]);
  });

  it("should fail when a configuration names a preset that does not exist", async () => {
    const root = await fixtureRoot({
      cmake: FIXTURE_CMAKE,
      matrix: fixtureMatrix({
        configurations: [
          {
            cacheVariables: {},
            directory: "tn-linux",
            owner: "default contract lane",
            preset: "tn-renamed-away",
            runs: ["threenative-alpha-test", "threenative-beta-test"],
          },
        ],
      }),
      presets: FIXTURE_PRESETS,
    });

    await expect(buildMatrixErrors(root)).resolves.toEqual([
      expect.stringContaining(
        'configuration tn-linux names preset "tn-renamed-away", which CMakePresets.json does not declare',
      ),
    ]);
  });

  it("should fail when a cache variable is not a declared option", async () => {
    const root = await fixtureRoot({
      cmake: FIXTURE_CMAKE,
      matrix: fixtureMatrix({
        configurations: [
          {
            cacheVariables: { TN_ENABLE_BOGUS: "ON", TN_ENABLE_COVERAGE: "ON" },
            directory: "tn-linux-coverage",
            owner: "coverage lane",
            preset: "tn-linux",
            runs: ["threenative-alpha-test", "threenative-beta-test"],
          },
        ],
      }),
      presets: FIXTURE_PRESETS,
    });

    await expect(buildMatrixErrors(root)).resolves.toEqual([
      expect.stringContaining(
        "configuration tn-linux-coverage sets TN_ENABLE_BOGUS, which CMakeLists.txt never declares",
      ),
    ]);
  });

  it("should fail when a runs entry names no real test target", async () => {
    const root = await fixtureRoot({
      cmake: FIXTURE_CMAKE,
      matrix: fixtureMatrix({
        configurations: [
          {
            cacheVariables: {},
            directory: "tn-linux",
            owner: "default contract lane",
            preset: "tn-linux",
            runs: ["threenative-alpha-test", "threenative-beta-test", "threenative-ghost-test"],
          },
        ],
      }),
      presets: FIXTURE_PRESETS,
    });

    await expect(buildMatrixErrors(root)).resolves.toEqual([
      expect.stringContaining(
        "configuration tn-linux runs threenative-ghost-test, which CMakeLists.txt never declares",
      ),
    ]);
  });

  it("should fail when a configuration leaves its owner empty", async () => {
    const root = await fixtureRoot({
      cmake: FIXTURE_CMAKE,
      matrix: fixtureMatrix({
        configurations: [
          {
            cacheVariables: {},
            directory: "tn-linux",
            owner: "   ",
            preset: "tn-linux",
            runs: ["threenative-alpha-test", "threenative-beta-test"],
          },
        ],
      }),
      presets: FIXTURE_PRESETS,
    });

    await expect(buildMatrixErrors(root)).resolves.toEqual([
      expect.stringContaining("configuration tn-linux has an empty owner"),
    ]);
  });

  it("should fail when two configurations claim the same build directory", async () => {
    const duplicate: IMatrixConfiguration = {
      cacheVariables: {},
      directory: "tn-linux",
      owner: "default contract lane",
      preset: "tn-linux",
      runs: ["threenative-alpha-test", "threenative-beta-test"],
    };
    const root = await fixtureRoot({
      cmake: FIXTURE_CMAKE,
      matrix: fixtureMatrix({ configurations: [duplicate, { ...duplicate }] }),
      presets: FIXTURE_PRESETS,
    });

    await expect(buildMatrixErrors(root)).resolves.toEqual([
      expect.stringContaining("build-matrix declares directory tn-linux twice"),
    ]);
  });

  it("should accept a consistent fixture", async () => {
    const root = await fixtureRoot({
      cmake: FIXTURE_CMAKE,
      matrix: fixtureMatrix(),
      presets: FIXTURE_PRESETS,
    });

    await expect(buildMatrixErrors(root)).resolves.toEqual([]);
  });

  it("should fail closed when the matrix file is missing from a real-shaped tree", async () => {
    const root = await makeMatrixFixtureRoot();
    const packageDir = path.join(root, "packages", "runtime-native");
    await writeFile(path.join(packageDir, "CMakeLists.txt"), FIXTURE_CMAKE);
    await writeFile(path.join(packageDir, "CMakePresets.json"), JSON.stringify(FIXTURE_PRESETS));

    await expect(buildMatrixErrors(root)).resolves.toEqual([
      expect.stringContaining("build-matrix.json is missing"),
    ]);
  });

  it("should no-op on a tree that carries no native package", async () => {
    await expect(
      buildMatrixErrors(await makeTempDir("threenative-build-matrix-")),
    ).resolves.toEqual([]);
  });

  it("should enforce the real tree", async () => {
    const repoRoot = path.join(import.meta.dirname, "..", "..");
    await expect(buildMatrixErrors(repoRoot)).resolves.toEqual([]);
  });
});

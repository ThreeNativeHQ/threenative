import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

const nativeInputExtensions = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cxx",
  ".h",
  ".hh",
  ".hpp",
  ".hxx",
  ".m",
  ".mm",
]);

const coverageInfrastructure = [
  "CMakeLists.txt",
  "CMakePresets.json",
  "scripts/measure-native-coverage.mjs",
  "scripts/native-coverage-evidence.mjs",
  "scripts/native-test-lane.mjs",
  "scripts/verify-native-contracts.mjs",
];

function visitNativeInputs(directory, files) {
  if (!existsSync(directory)) throw new Error(`native coverage input is missing: ${directory}`);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) visitNativeInputs(entryPath, files);
    else if (nativeInputExtensions.has(entry.name.slice(entry.name.lastIndexOf(".")))) {
      files.push(entryPath);
    }
  }
}

function visitAllInputs(directory, files) {
  if (!existsSync(directory)) throw new Error(`native coverage input is missing: ${directory}`);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) visitAllInputs(entryPath, files);
    else files.push(entryPath);
  }
}

/**
 * `tests/` holds two unrelated populations, and only one of them can move native coverage.
 *
 * The 40 `.cpp` files compile into the binaries ctest runs, and the fixtures steer what those
 * binaries execute - `webgpu_bindings_reentrancy_test.cpp` reads `fixtures/`, so a fixture edit
 * really can change which branches are covered. Both stay hashed.
 *
 * The files vitest collects cannot. `packages/runtime-native/vitest.config.ts` runs
 * `tests/**\/*.test.{ts,mjs}` under Node; `scripts/measure-native-coverage.mjs` reads nothing from
 * `tests/` at all - it runs ctest over compiled binaries and parses llvm-cov. Hashing them made
 * every Node-test edit invalidate a digest whose numbers could not have changed, which forced a
 * restamp on 7 pull requests in one evening and conflicted them against each other on the one
 * generated line. The coverage-infrastructure list above still pins `measure-native-coverage.mjs`
 * and `native-test-lane.mjs` by name, so the machinery that produces the numbers is unchanged.
 */
function isVitestCollected(entryPath) {
  return /\.test\.(?:ts|mjs)$/u.test(entryPath);
}

function visitCoverageRelevantTestInputs(directory, files) {
  if (!existsSync(directory)) throw new Error(`native coverage input is missing: ${directory}`);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) visitCoverageRelevantTestInputs(entryPath, files);
    else if (!isVitestCollected(entryPath)) files.push(entryPath);
  }
}

export function nativeCoverageInputFiles(runtimeRoot) {
  const files = coverageInfrastructure.map((path) => join(runtimeRoot, path));
  visitAllInputs(join(runtimeRoot, "cmake"), files);
  visitNativeInputs(join(runtimeRoot, "include"), files);
  visitAllInputs(join(runtimeRoot, "src", "runtime-scripts"), files);
  visitNativeInputs(join(runtimeRoot, "src"), files);
  visitCoverageRelevantTestInputs(join(runtimeRoot, "tests"), files);
  for (const file of files) {
    if (!existsSync(file)) throw new Error(`native coverage input is missing: ${file}`);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

export function nativeCoverageEvidenceDigest(runtimeRoot) {
  const hash = createHash("sha256");
  for (const file of nativeCoverageInputFiles(runtimeRoot)) {
    hash.update(relative(runtimeRoot, file).split(sep).join("/"));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

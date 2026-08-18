import { makeTempDirSync } from '../../../test-support/temp-dir.js';
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { existsSync } from "node:fs";

import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Native compilation is opt-in and the default repository gate must not require CMake, so the
 * two cases that configure it run wherever CMake exists and skip where it does not — rather
 * than being hardcoded to a path that made them skip everywhere, including CI.
 */
const hasCmake = (process.env.PATH ?? "")
  .split(delimiter)
  .some((entry) => entry.length > 0 && existsSync(join(entry, "cmake")));

/**
 * The version the binary reports must be the version the package declares.
 *
 * Release `v0.1.14` shipped a runtime whose launch log read `Version: 0.1.13`. The consumer
 * proof saw a skew it could not explain, and ten releases were built and deleted before it was
 * traced to `CMakeLists.txt` carrying a second, hand-maintained copy of the number. Nothing
 * failed when the two diverged, which is the defect this file exists to make impossible.
 */

const runtimeRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cmakeFile = join(runtimeRoot, "CMakeLists.txt");

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

/** Configures CMake far enough to evaluate `project()`, without building anything. */
function projectVersion(packageVersion) {
  const root = makeTempDirSync("threenative-version-stamp-");
  roots.push(root);
  writeFileSync(join(root, "package.json"), JSON.stringify({ version: packageVersion }));
  // Only the version preamble is exercised: the real CMakeLists pulls in SDL3, Dawn and the
  // rest, which is a build, not a unit test.
  const preamble = readFileSync(cmakeFile, "utf8").split("LANGUAGES C CXX)")[0];
  writeFileSync(
    join(root, "CMakeLists.txt"),
    `${preamble}LANGUAGES NONE)\nmessage(STATUS "TN_PROJECT_VERSION=\${PROJECT_VERSION}")\n`,
  );
  return execFileSync("cmake", ["-S", root, "-B", join(root, "build")], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("the native runtime's version stamp", () => {
  it("is not typed into CMakeLists.txt", () => {
    // The literal is the defect. A test that only compared the two numbers would pass the
    // moment somebody bumped both by hand, and fail again the next time they forgot.
    const preamble = readFileSync(cmakeFile, "utf8").split("\n").slice(0, 20).join("\n");
    expect(preamble).not.toMatch(/project\([^)]*VERSION\s+\d+\.\d+\.\d+/u);
    expect(preamble).toMatch(/string\(JSON\s+\w+\s+GET\s+"\$\{MYSTRAL_PACKAGE_JSON\}"\s+version\)/u);
  });

  it.runIf(hasCmake)(
    "reports the version package.json declares",
    () => {
      expect(projectVersion("9.8.7")).toMatch(/TN_PROJECT_VERSION=9\.8\.7/u);
    },
  );

  it.runIf(hasCmake)(
    "refuses to configure rather than stamp a version it cannot read",
    () => {
      // Fail closed: a runtime that misreports its version is what sent ten releases into the
      // consumer proof with an unexplained skew.
      expect(() => projectVersion("not-a-version")).toThrow(/TN_NATIVE_VERSION_UNREADABLE/u);
    },
  );
});

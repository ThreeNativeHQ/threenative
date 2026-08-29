import { describe, expect, it } from "vitest";

import { staleGeneratorBuildDirectory } from "../scripts/measure-native-coverage.mjs";

// The coverage lane configures with -G "Unix Makefiles" (1e530c4a). Every other lane uses the
// tn-linux preset's Ninja. When build/tn-linux-coverage/ was left by a Ninja run, cmake failed
// with a raw "Does not match the generator used previously" dump that named no fix, and the whole
// gate read as a broken native build rather than a stale directory.
describe("coverage build directory generator check", () => {
  const cache = (generator) => `CMAKE_GENERATOR:INTERNAL=${generator}\nOTHER:BOOL=ON\n`;

  it("names the directory when its cache was configured by another generator", () => {
    expect(
      staleGeneratorBuildDirectory("build/tn-linux-coverage", "Unix Makefiles", {
        existsSyncImpl: () => true,
        readFileSyncImpl: () => cache("Ninja"),
      }),
    ).toBe("build/tn-linux-coverage");
  });

  it("returns null when the generator already matches", () => {
    expect(
      staleGeneratorBuildDirectory("build/tn-linux-coverage", "Unix Makefiles", {
        existsSyncImpl: () => true,
        readFileSyncImpl: () => cache("Unix Makefiles"),
      }),
    ).toBeNull();
  });

  it("returns null when there is no cache to conflict with", () => {
    expect(
      staleGeneratorBuildDirectory("build/tn-linux-coverage", "Unix Makefiles", {
        existsSyncImpl: () => false,
        readFileSyncImpl: () => {
          throw new Error("must not read a cache that does not exist");
        },
      }),
    ).toBeNull();
  });

  // Fail closed: an unreadable generator line is not "no conflict", it is an unknown state.
  it("names the directory when the cache has no generator line", () => {
    expect(
      staleGeneratorBuildDirectory("build/tn-linux-coverage", "Unix Makefiles", {
        existsSyncImpl: () => true,
        readFileSyncImpl: () => "OTHER:BOOL=ON\n",
      }),
    ).toBe("build/tn-linux-coverage");
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  blockedRegistrationReason,
  configuredWebgpuBackend,
  staleGeneratorBuildDirectory,
} from "../scripts/measure-native-coverage.mjs";
import { runtimeRoot } from "../scripts/native-test-lane.mjs";
import {
  discoverNativeTestTargetConditions,
  optionallyConfiguredNativeTestTargets,
  targetsMissingBlockedRegistration,
} from "../scripts/verify-native-contracts.mjs";

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

// A target that only exists when an optional dependency was found - the WebTransport pair behind
// `if(TARGET quiche::quiche)`, the recorder behind `if(TN_ENABLE_VIDEO)` - is written in
// CMakeLists.txt whether or not this machine has that dependency. Discovery reads the file as
// text, so it lists the target either way, and the coverage lane then requires CTest to know it.
// A configure without quiche registered nothing at all for the WebTransport pair, so the lane
// threw `CTest omitted native target: threenative-webtransport-surface-test` on a machine that had
// simply never downloaded quiche, and `pnpm regen` stopped there for everyone touching this tree.
// `tn_register_blocked_test` is the answer already in use: it registers a DISABLED entry carrying
// the reason, so the configure still accounts for the target without building it.
describe("optional native test targets", () => {
  const cmakeSource = readFileSync(join(runtimeRoot, "CMakeLists.txt"), "utf8");

  it("registers a blocked placeholder for every conditionally configured target", () => {
    expect(targetsMissingBlockedRegistration(cmakeSource)).toEqual([]);
  });

  it("counts only the conditions a target does not share with every other target", () => {
    const optional = optionallyConfiguredNativeTestTargets(cmakeSource);
    // The desktop platform guard wraps all of them and makes none of them optional.
    expect(optional.has("threenative-audio-graph-test")).toBe(false);
    expect(optional.get("threenative-webtransport-surface-test")).toEqual([
      "if(TARGET quiche::quiche)",
    ]);
    expect(optional.get("threenative-video-recorder-state-test")).toEqual(["if(TN_ENABLE_VIDEO)"]);
  });

  // Fail closed: the scan tracks if()/endif() by counting lines, so a file it cannot balance is an
  // unknown nesting state, not an empty one.
  it("refuses a source whose if() blocks do not close", () => {
    expect(() =>
      discoverNativeTestTargetConditions('if(TN_ENABLE_VIDEO)\nadd_executable(threenative-a-test)'),
    ).toThrow(/unclosed/u);
  });
});

// Which optional targets a configure skipped varies by machine - quiche is downloaded on some and
// not others - so the lane reads the reason off the CTest entry the configure wrote rather than a
// list of names in the script, which could not be right on both machines at once.
describe("blocked CTest registrations", () => {
  const blocked = (reason) => ({
    command: ["cmake", "-E", "echo", `BLOCKED: ${reason}`],
    name: "threenative-webtransport-surface-test",
    properties: [
      { name: "DISABLED", value: true },
      { name: "LABELS", value: ["blocked", "native-contract"] },
    ],
  });
  const live = {
    command: ["/build/threenative-audio-graph-test"],
    name: "threenative-audio-graph-test",
    properties: [{ name: "LABELS", value: ["native-contract"] }],
  };

  it("reports the reason the configure echoed", () => {
    expect(
      blockedRegistrationReason([blocked("quiche not found"), live], "threenative-webtransport-surface-test"),
    ).toBe("quiche not found");
  });

  it("does not blank a live test, which has to build and run", () => {
    expect(blockedRegistrationReason([blocked("quiche not found"), live], "threenative-audio-graph-test")).toBeUndefined();
  });

  // Fail closed: a target CTest never registered is the original defect, not a blocked one. It has
  // no reason to report, so the caller's registration check still throws on it.
  it("does not invent a reason for a target CTest never registered", () => {
    expect(blockedRegistrationReason([live], "threenative-webtransport-surface-test")).toBeUndefined();
  });

  // A DISABLED entry that is not labelled blocked was disabled by something else; only the
  // placeholder tn_register_blocked_test writes counts as an accounted-for absence.
  it("requires both the DISABLED property and the blocked label", () => {
    const disabledOnly = {
      ...blocked("quiche not found"),
      properties: [{ name: "DISABLED", value: true }],
    };
    expect(
      blockedRegistrationReason([disabledOnly], "threenative-webtransport-surface-test"),
    ).toBeUndefined();
  });
});

// A worktree that never ran pnpm native:build configures without complaint and then dies eight
// compiler errors deep in runtime.cpp, because the full BindingsState and the WGPUPresentMode_*
// constants live behind the backend defines. The lane reads the backend off the configure so it
// can say that, instead of handing back a compile dump for a missing download.
describe("configured WebGPU backend", () => {
  it("names the backend the configure put on the compile line", () => {
    expect(
      configuredWebgpuBackend([
        { command: "clang++ -DMYSTRAL_WEBGPU_DAWN -O2 -c src/runtime.cpp", file: "src/runtime.cpp" },
      ]),
    ).toBe("dawn");
    expect(
      configuredWebgpuBackend([
        { arguments: ["clang++", "-DMYSTRAL_WEBGPU_WGPU", "-c", "src/runtime.cpp"] },
      ]),
    ).toBe("wgpu");
  });

  it("reports none when the configure found no backend at all", () => {
    expect(
      configuredWebgpuBackend([{ command: "clang++ -O2 -c src/runtime.cpp", file: "src/runtime.cpp" }]),
    ).toBeUndefined();
    expect(configuredWebgpuBackend([])).toBeUndefined();
  });
});

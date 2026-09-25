/**
 * A release distributable ships only the slice a phone installs.
 *
 * Play installs `arm64-v8a` on a phone; the `x86_64` slice exists for the emulator dev lane, so
 * only debug keeps it. The packager knows the mode and is the one place that decides, because
 * Gradle would have to guess a build type from a task name. An explicit `-PthreenativeAbis` from
 * the caller wins in both modes — whoever names the set has decided.
 */

import { describe, expect, it } from "vitest";

// @ts-expect-error -- plain ESM with no type declarations.
import { androidArtifactLibraryCensus } from "../scripts/check-android-16kb-alignment.mjs";
// @ts-expect-error -- the packager is plain ESM with no type declarations.
import { androidAbiGradleArgs, androidRequestedAbis } from "../scripts/package-android.mjs";

describe("android ABI default", () => {
  it("release without an explicit list ships arm64-v8a only", () => {
    expect(androidAbiGradleArgs("release")).toEqual(["-PthreenativeAbis=arm64-v8a"]);
  });

  it("debug keeps both ABIs so the x86_64 emulator lane installs", () => {
    // Gradle's own default (build.gradle.kts) is arm64-v8a,x86_64.
    expect(androidAbiGradleArgs("debug")).toEqual([]);
  });

  it("an explicit -PthreenativeAbis list wins in both modes", () => {
    expect(androidAbiGradleArgs("release", ["-PthreenativeAbis=x86_64"])).toEqual([]);
    expect(androidAbiGradleArgs("debug", ["-PthreenativeAbis=arm64-v8a"])).toEqual([]);
  });

  it("the 16 KB census checks the ABI set the build asked for", () => {
    const release = ["assembleRelease", ...androidAbiGradleArgs("release")];
    expect(androidRequestedAbis(release)).toEqual(["arm64-v8a"]);
    expect(androidRequestedAbis(["assembleDebug"])).toBeUndefined();
    expect(
      androidRequestedAbis(["-PthreenativeAbis=x86_64", "-PthreenativeAbis= arm64-v8a ,x86_64"]),
    ).toEqual(["arm64-v8a", "x86_64"]);
    const arm64Only = [{ name: "lib/arm64-v8a/libmystral-runtime.so" }];
    expect(() =>
      androidArtifactLibraryCensus(arm64Only, { abis: androidRequestedAbis(release) }),
    ).not.toThrow();
    // Gradle's default set still demands both slices.
    expect(() => androidArtifactLibraryCensus(arm64Only)).toThrow(
      /no native libraries for x86_64/u,
    );
  });
});

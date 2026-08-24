import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Android 15 and later can run with 16 KB memory pages, where a shared library whose LOAD
 * segments are aligned to the older 4 KB cannot be loaded at all. The system says so ahead of
 * time, on devices still running 4 KB pages, with a modal "Android App Compatibility" dialog over
 * the game naming each offending library — which covers the whole screen, so a blind
 * `adb shell screencap` captures the dialog instead of the frame.
 *
 * Two of the three offenders were fixed by a link option and a dependency bump. Nothing in the
 * build fails when either is quietly removed, which is exactly how `react()` and `tailwindcss()`
 * left every template's Vite config, so both are asserted here.
 */
const RUNTIME = path.resolve("packages/runtime-native");

/**
 * Every line outside `package-android.mjs` that writes an SDL3 version out by hand.
 *
 * The version lived in four places, and the bump to 3.2.30 left three of them naming an archive
 * that no longer existed — one surfacing as a Gradle input-file error three layers away from the
 * pin it disagreed with. Comments are skipped: the reason for the pin is prose, not a second copy.
 */
async function sdl3VersionLiterals(): Promise<readonly string[]> {
  const scripts = path.join(RUNTIME, "scripts");
  const files: Array<readonly [string, string]> = [
    ...(await readdir(scripts)).map((entry) => [scripts, entry] as const),
    [path.join(RUNTIME, "android", "app"), "build.gradle.kts"] as const,
    [RUNTIME, "CMakeLists.txt"] as const,
  ];
  const offenders: string[] = [];
  for (const [directory, entry] of files) {
    if (!/\.(mjs|kts|txt)$/.test(entry) || entry === "package-android.mjs") continue;
    const source = await readFile(path.join(directory, entry), "utf8").catch(() => "");
    const named = source
      .split("\n")
      .filter((line) => !/^\s*(\/\/|#)/.test(line))
      .filter((line) => /SDL3-\d+\.\d+\.\d+/.test(line));
    offenders.push(...named.map((line) => `${entry}: ${line.trim()}`));
  }
  return offenders;
}

describe("android 16 KB page alignment", () => {
  it("links the Android shared library with 16 KB LOAD alignment", async () => {
    const cmake = await readFile(path.join(RUNTIME, "CMakeLists.txt"), "utf8");
    // The option belongs to the `SHARED` branch: it is the .so that Android loads, and the
    // desktop/iOS build produces a static archive that never carries LOAD segments of its own.
    const androidBranch =
      /if\(ANDROID\)\s*\n\s*add_library\(mystral-runtime SHARED[\s\S]*?\nelse\(\)/.exec(cmake)?.[0];
    expect(androidBranch, "the ANDROID add_library(mystral-runtime SHARED) branch").toBeDefined();
    expect(androidBranch).toContain("max-page-size=16384");
  });

  it("keeps the SDL3 Android version in one place", async () => {
    const scripts = path.join(RUNTIME, "scripts");
    const owner = await readFile(path.join(scripts, "package-android.mjs"), "utf8");
    const version = /export const SDL3_ANDROID_VERSION = '([^']+)'/.exec(owner)?.[1];
    expect(version, "SDL3_ANDROID_VERSION in package-android.mjs").toBeDefined();

    // SDL 3.2.30 is the first release in this line whose 64-bit Android libraries carry 16 KB
    // alignment. Older ones do not, so a downgrade silently reintroduces the dialog.
    const [major = 0, minor = 0, patch = 0] = (version ?? "0.0.0").split(".").map(Number);
    expect(major * 1_000_000 + minor * 1_000 + patch).toBeGreaterThanOrEqual(
      3 * 1_000_000 + 2 * 1_000 + 30,
    );

    expect(await sdl3VersionLiterals()).toEqual([]);
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PRD-226's ablation arms deliberately render the wrong picture: `TN_ABLATE_BACKEND` no-ops the hot
 * backend command entry points so the frame can be decomposed by subtraction. A build carrying it is
 * a measurement build and must never reach a user, a preset, a CI lane or a shipped Android config.
 *
 * The mutation that reddens this file: set the option's default to `ON` in
 * `packages/runtime-native/CMakeLists.txt`, or add `"TN_ABLATE_BACKEND": "ON"` to any preset's
 * `cacheVariables`.
 */

const repoRoot = join(import.meta.dirname, "..", "..");
const runtimeNative = join(repoRoot, "packages", "runtime-native");

const ABLATION_FLAGS = ["TN_ABLATE_BACKEND"] as const;

interface ICMakePresets {
  readonly configurePresets?: ReadonlyArray<{
    readonly name: string;
    readonly cacheVariables?: Readonly<Record<string, unknown>>;
  }>;
}

describe("PRD-226 ablation flags never ship", () => {
  it("declares every ablation flag OFF by default", () => {
    const cmake = readFileSync(join(runtimeNative, "CMakeLists.txt"), "utf8");
    for (const flag of ABLATION_FLAGS) {
      const declaration = new RegExp(`option\\(${flag}\\s+"[^"]*"\\s+(\\w+)\\)`).exec(cmake);
      expect(declaration, `${flag} must be declared with option()`).not.toBeNull();
      expect(declaration?.[1], `${flag} must default to OFF`).toBe("OFF");
    }
  });

  it("enables no ablation flag in any CMake preset", () => {
    const presets = JSON.parse(
      readFileSync(join(runtimeNative, "CMakePresets.json"), "utf8"),
    ) as ICMakePresets;
    const configurePresets = presets.configurePresets ?? [];
    expect(configurePresets.length).toBeGreaterThan(0);

    for (const preset of configurePresets) {
      for (const flag of ABLATION_FLAGS) {
        expect(
          preset.cacheVariables?.[flag],
          `preset ${preset.name} must not set ${flag}`,
        ).toBeUndefined();
      }
    }
  });

  it("enables no ablation flag in the shipped Android build", () => {
    const gradle = readFileSync(join(runtimeNative, "android", "app", "build.gradle.kts"), "utf8");
    for (const flag of ABLATION_FLAGS) {
      expect(gradle.includes(flag), `build.gradle.kts must not name ${flag}`).toBe(false);
    }
  });

  it("guards the ablation header behind its flag", () => {
    const header = readFileSync(join(runtimeNative, "src", "webgpu", "ablation.h"), "utf8");
    // Every redefinition lives inside the flag's #if; nothing leaks into a default build.
    const guarded = header.slice(header.indexOf("#if defined(TN_ABLATE_BACKEND)"));
    for (const line of header.split("\n")) {
      if (!line.startsWith("#define wgpu")) continue;
      expect(guarded.includes(line), `${line} must sit inside the TN_ABLATE_BACKEND guard`).toBe(
        true,
      );
    }
    expect(header).toContain("#endif  // TN_ABLATE_BACKEND");
  });
});

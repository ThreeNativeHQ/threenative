import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const workflow = readFileSync(join(root, ".github/workflows/native-release.yml"), "utf8");
const androidPackager = readFileSync(
  join(root, "packages/runtime-native/scripts/package-android.mjs"),
  "utf8",
);

test("native release stages the SDL3 Android AAR version owned by the packager", () => {
  const version = androidPackager.match(
    /export const SDL3_ANDROID_VERSION = '([^']+)'/u,
  )?.[1];
  assert.ok(version, "package-android.mjs must declare SDL3_ANDROID_VERSION");
  assert.match(
    workflow,
    new RegExp(`third_party/sdl3-android/SDL3-${version.replaceAll(".", "\\.")}\\.aar`, "u"),
  );
});

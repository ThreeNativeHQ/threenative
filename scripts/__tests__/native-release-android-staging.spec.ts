import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const workflow = readFileSync(join(root, ".github/workflows/native-release.yml"), "utf8");

// The staging step copies a third-party AAR whose filename carries the SDL version. Spelled out in
// the workflow it drifted: package-android.mjs moved to 3.2.30 - deliberately, because 3.2.8's
// 64-bit libraries are not 16 KB LOAD-aligned - while the workflow still asked for SDL3-3.2.8.aar,
// so the first run that reached this step died with ENOENT on a file that had not existed for some
// time. Only a tag push reached that code, so no earlier gate could catch it.
//
// Asserting the literal matches the packager would only detect the next drift. Requiring the name
// to be *derived* removes the failure mode instead, so this checks the derivation, that it
// resolves to a real version, and that download-deps.mjs builds its URL from the same constant.
test("native release stages the SDL3 Android AAR version owned by the packager", () => {
  const staging = workflow.match(
    /- name: Stage Android runtime payloads\n[\s\S]*?\n\x20{10}NODE\n/u,
  )?.[0];
  assert.ok(staging, "missing the Android staging step");

  assert.match(staging, /SDL3-\$\{SDL3_ANDROID_VERSION\}\.aar/u);
  // Comment lines may name the old filename to explain the drift; only executable lines are bound.
  const code = staging
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  assert.doesNotMatch(
    code,
    /SDL3-\d+\.\d+\.\d+\.aar/u,
    "the AAR filename must derive from SDL3_ANDROID_VERSION, never a literal version",
  );

  // Read rather than import: package-android.mjs is plain JavaScript with no declaration file, so
  // importing it is an implicit `any` under this project's noImplicitAny (TS7016).
  const androidPackager = readFileSync(
    join(root, "packages/runtime-native/scripts/package-android.mjs"),
    "utf8",
  );
  const version = androidPackager.match(/export const SDL3_ANDROID_VERSION = '([^']+)'/u)?.[1];
  assert.ok(version, "package-android.mjs must declare SDL3_ANDROID_VERSION");
  assert.match(version, /^\d+\.\d+\.\d+$/u);

  const deps = readFileSync(
    join(root, "packages/runtime-native/scripts/download-deps.mjs"),
    "utf8",
  );
  assert.match(deps, /SDL3-devel-\$\{DEPS\['sdl3-android'\]\.version\}-android\.zip/u);
  assert.match(deps, /version: SDL3_ANDROID_VERSION/u);
});

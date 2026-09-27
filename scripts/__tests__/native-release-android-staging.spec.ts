import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "vitest";
import { makeTempDirSync } from "../../test-support/temp-dir.js";

const root = resolve(import.meta.dirname, "../..");
const workflow = readFileSync(join(root, ".github/workflows/native-release.yml"), "utf8");

test.skipIf(process.platform === "win32")(
  "Android CI staging reads the current AGP task outputs, never stale pre-upgrade files",
  () => {
    const directory = makeTempDirSync("android-release-staging-");
    const put = (name: string, value: string) => {
      const file = join(directory, name);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, value);
    };
    try {
      const runtime = "packages/runtime-native";
      const stripped = `${runtime}/android/app/build/intermediates/stripped_native_libs/release`;
      put(
        `${runtime}/scripts/package-android.mjs`,
        'export const SDL3_ANDROID_VERSION = "3.2.30";',
      );
      put(`${runtime}/third_party/sdl3-android/SDL3-3.2.30.aar`, "aar");
      for (const abi of ["arm64-v8a", "x86_64"]) {
        for (const library of [
          "libmystral-runtime.so",
          "libv8android.so",
          "libc++_shared.so",
          "libSDL3.so",
        ]) {
          put(
            `${stripped}/stripReleaseDebugSymbols/out/lib/${abi}/${library}`,
            `current ${abi} ${library}`,
          );
          put(`${stripped}/out/lib/${abi}/${library}`, "stale");
        }
        put(
          `${runtime}/android/app/build/generated/threenative/assets/v8/${abi}/snapshot_blob.bin`,
          abi,
        );
      }
      const quickjs = workflow.match(
        /- name: Stage the QuickJS Android runtimes\n\s+run: \|\n([\s\S]*?)\n {6}- name:/u,
      )?.[1];
      const v8 = workflow.match(
        /- name: Stage Android runtime payloads[\s\S]*?node --input-type=module <<'NODE'\n([\s\S]*?)\n\s+NODE\n/u,
      )?.[1];
      assert.ok(quickjs && v8, "both engine staging steps must exist");
      execFileSync("sh", ["-eu", "-c", quickjs], { cwd: directory });
      execFileSync(process.execPath, ["--input-type=module"], { cwd: directory, input: v8 });
      for (const abi of ["arm64-v8a", "x86_64"]) {
        for (const suffix of ["", "-v8"]) {
          assert.equal(
            readFileSync(
              join(directory, `release/threenative-runtime-android-${abi}${suffix}.so`),
              "utf8",
            ),
            `current ${abi} libmystral-runtime.so`,
          );
        }
        for (const [output, library] of [
          ["v8", "libv8android.so"],
          ["libcxx", "libc++_shared.so"],
          ["sdl3", "libSDL3.so"],
        ]) {
          assert.equal(
            readFileSync(
              join(directory, `release/threenative-${output}-android-${abi}.so`),
              "utf8",
            ),
            `current ${abi} ${library}`,
          );
        }
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

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

  const packager = readFileSync(
    join(root, "packages/runtime-native/scripts/package-android.mjs"),
    "utf8",
  );
  const SDL3_ANDROID_VERSION = packager.match(
    /export const SDL3_ANDROID_VERSION = '([^']+)'/u,
  )?.[1];
  assert.ok(SDL3_ANDROID_VERSION, "package-android.mjs must declare SDL3_ANDROID_VERSION");
  assert.match(SDL3_ANDROID_VERSION, /^\d+\.\d+\.\d+$/u);

  const deps = readFileSync(
    join(root, "packages/runtime-native/scripts/download-deps.mjs"),
    "utf8",
  );
  assert.match(deps, /SDL3-devel-\$\{DEPS\['sdl3-android'\]\.version\}-android\.zip/u);
  assert.match(deps, /version: SDL3_ANDROID_VERSION/u);
});

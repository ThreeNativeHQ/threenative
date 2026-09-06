import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, test } from "vitest";

import { makeTempDirSync } from "../../../test-support/temp-dir.js";
import {
  REQUIRED_ARCHIVES,
  gnArgsFor,
  resolveBuildTools,
  stageSkiaAndroid,
  verifySkiaAndroidCache,
} from "../scripts/build-skia-android.mjs";

const temporary = [];

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { force: true, recursive: true });
});

function tempDir(prefix) {
  const dir = makeTempDirSync(prefix);
  temporary.push(dir);
  return dir;
}

test("missing NDK fails closed with a named error, never a silent fallback", () => {
  assert.throws(
    () =>
      resolveBuildTools({
        androidHome: tempDir("threenative-no-sdk-"),
        pathEntries: [],
      }),
    /TN_ANDROID_NDK_MISSING/u,
  );
});

test("missing ninja fails closed with a named error", () => {
  const home = tempDir("threenative-no-ninja-");
  const ndk = join(home, "ndk", "27.1.12297006");
  mkdirSync(join(ndk, "toolchains", "llvm", "prebuilt", "linux-x86_64", "bin"), {
    recursive: true,
  });
  assert.throws(
    () => resolveBuildTools({ androidHome: home, pathEntries: [] }),
    /TN_NINJA_MISSING/u,
  );
});

test("missing gn fails closed with a named error", () => {
  const home = tempDir("threenative-no-gn-");
  const ndk = join(home, "ndk", "27.1.12297006");
  mkdirSync(join(ndk, "toolchains", "llvm", "prebuilt", "linux-x86_64", "bin"), {
    recursive: true,
  });
  const ninja = join(home, "ninja");
  writeFileSync(ninja, "fake");
  assert.throws(
    () =>
      resolveBuildTools({
        androidHome: home,
        pathEntries: [home],
      }),
    /TN_GN_MISSING/u,
  );
});

test("unsupported architecture fails closed", () => {
  assert.throws(() => gnArgsFor({ ndkPath: "/ndk", arch: "x86" }), /TN_SKIA_ANDROID_ARCH/u);
});

test("generated GN args keep the proven set minus the removed options", () => {
  const args = gnArgsFor({ ndkPath: "/ndk/27.1.12297006", arch: "arm64" });
  assert.match(args, /target_os="android"/u);
  assert.match(args, /target_cpu="arm64"/u);
  assert.match(args, /skia_use_expat=true/u);
  assert.match(args, /skia_use_freetype=true/u);
  assert.match(args, /skia_use_system_freetype2=false/u);
  assert.match(args, /skia_use_system_libpng=false/u);
  assert.match(args, /skia_use_system_zlib=false/u);
  assert.match(args, /is_official_build=true/u);
  for (const removed of ["android_ndk_version", "skia_use_gpu", "skia_enable_sksl"]) {
    assert.doesNotMatch(args, new RegExp(removed, "u"));
  }
});

function writeCompleteBuildOut(outDir) {
  mkdirSync(outDir, { recursive: true });
  for (const name of REQUIRED_ARCHIVES) {
    writeFileSync(join(outDir, `lib${name}.a`), `${name} fixture`);
  }
  writeFileSync(join(outDir, "args.gn"), "fixture");
}

test("incomplete cache fails closed and names the missing archive", () => {
  const root = tempDir("threenative-skia-cache-");
  const outDir = join(root, "skia", "out", "android-arm64");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "libskia.a"), "only skia");
  assert.throws(() => verifySkiaAndroidCache(root), /TN_SKIA_ANDROID_CACHE_INCOMPLETE/u);
});

test("complete cache with a matching receipt verifies without rebuilding", () => {
  const root = tempDir("threenative-skia-cache-");
  const outDir = join(root, "skia", "out", "android-arm64");
  writeCompleteBuildOut(outDir);
  const receipt = verifySkiaAndroidCache(root);
  assert.equal(receipt.arch, "arm64");
  assert.equal(receipt.complete, true);
  // A second call must also verify: cache hits are repeatable.
  assert.equal(verifySkiaAndroidCache(root).complete, true);
});

test("a receipt for another pin does not satisfy the cache", () => {
  const root = tempDir("threenative-skia-cache-");
  const outDir = join(root, "skia", "out", "android-arm64");
  writeCompleteBuildOut(outDir);
  assert.throws(
    () => verifySkiaAndroidCache(root, { skiaCommit: "deadbeef" }),
    /TN_SKIA_ANDROID_CACHE_INCOMPLETE|TN_SKIA_ANDROID_PIN_MISMATCH/u,
  );
});

test("staging lays out headers and all eight archives", () => {
  const root = tempDir("threenative-skia-stage-");
  const outDir = join(root, "skia", "out", "android-arm64");
  const skiaSrc = join(root, "skia");
  writeCompleteBuildOut(outDir);
  mkdirSync(join(skiaSrc, "include", "core"), { recursive: true });
  mkdirSync(join(skiaSrc, "include", "ports"), { recursive: true });
  writeFileSync(join(skiaSrc, "include", "core", "SkCanvas.h"), "fixture");
  writeFileSync(join(skiaSrc, "include", "ports", "SkFontMgr_android.h"), "fixture");
  const dest = join(root, "third_party", "skia-android", "build");
  const staged = stageSkiaAndroid({ sourceRoot: root, destDir: dest });
  assert.equal(staged.archives.length, 8);
  for (const name of REQUIRED_ARCHIVES) {
    assert.ok(
      staged.archives.includes(`lib${name}.a`),
      `staged set must include lib${name}.a`,
    );
  }
});

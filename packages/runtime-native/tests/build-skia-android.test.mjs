import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, test } from "vitest";

import { makeTempDirSync } from "../../../test-support/temp-dir.js";
import {
  DEP_PINS,
  GN_COMMIT,
  NDK_VERSION,
  REQUIRED_ARCHIVES,
  SKIA_COMMIT,
  buildSkiaAndroid,
  buildSkiaAndroidFromStagedSource,
  gnArgsFor,
  resolveBuildTools,
  stageSkiaAndroid,
  verifySkiaAndroidCache,
  verifySourcePins,
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

function writeExecutable(path) {
  writeFileSync(path, "#!/bin/sh\nexit 0\n");
  chmodSync(path, 0o755);
  return path;
}

function makeNdk(ndk) {
  const bin = join(ndk, "toolchains", "llvm", "prebuilt", "linux-x86_64", "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(ndk, "source.properties"), `Pkg.Revision = ${NDK_VERSION}\n`);
  writeExecutable(join(bin, "clang"));
  return ndk;
}

function validNdk(root) {
  return makeNdk(join(root, "ndk", NDK_VERSION));
}

function validTools(root) {
  return {
    ndkPath: validNdk(root),
    ninjaPath: writeExecutable(join(root, "ninja")),
    gnPath: writeExecutable(join(root, "gn")),
  };
}

function fixturePinRun(root) {
  const expected = new Map([
    [join(root, "skia"), SKIA_COMMIT],
    [join(root, "gn-src"), GN_COMMIT],
    [join(root, "skia", "third_party", "externals", "expat"), DEP_PINS.expat],
    [join(root, "skia", "third_party", "externals", "freetype"), DEP_PINS.freetype],
    [join(root, "skia", "third_party", "externals", "libpng"), DEP_PINS.libpng],
    [join(root, "skia", "third_party", "externals", "wuffs"), DEP_PINS.wuffs],
    [join(root, "skia", "third_party", "externals", "zlib"), DEP_PINS.zlib],
  ]);
  return (args) => expected.get(args[args.indexOf("-C") + 1]);
}

function writeArchives(outDir, token = "fixture") {
  mkdirSync(outDir, { recursive: true });
  for (const name of REQUIRED_ARCHIVES) writeFileSync(join(outDir, `lib${name}.a`), `${name}:${token}`);
}

function buildFixtureCache(root) {
  const outDir = join(root, "skia", "out", "android-arm64");
  mkdirSync(join(root, "tools"), { recursive: true });
  mkdirSync(join(root, "skia"), { recursive: true });
  const tools = validTools(join(root, "tools"));
  const calls = [];
  buildSkiaAndroid({
    sourceRoot: root,
    tools,
    pinRun: fixturePinRun(root),
    run: (command, args, options) => {
      calls.push({ command, args, options });
      if (command === tools.ninjaPath) writeArchives(outDir);
    },
  });
  return { calls, outDir, tools };
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

test("an explicit empty NDK is rejected", () => {
  const root = tempDir("threenative-empty-ndk-");
  const ndk = join(root, "empty-ndk");
  mkdirSync(ndk, { recursive: true });
  assert.throws(
    () => resolveBuildTools({ ndkPath: ndk, pathEntries: [] }),
    /TN_ANDROID_NDK_(MISSING|INVALID)/u,
  );
});

test("an explicit relocated NDK is accepted only when its pinned metadata is valid", () => {
  const root = tempDir("threenative-relocated-ndk-");
  const ndk = makeNdk(join(root, "relocated-ndk"));
  const resolved = resolveBuildTools({
    ndkPath: ndk,
    ninjaPath: writeExecutable(join(root, "ninja")),
    gnPath: writeExecutable(join(root, "gn")),
  });
  assert.equal(resolved.ndkPath, resolve(ndk));
});

test("an explicit missing ninja fails closed with a named error", () => {
  const home = tempDir("threenative-no-ninja-");
  validNdk(home);
  assert.throws(
    () => resolveBuildTools({ androidHome: home, ninjaPath: join(home, "missing-ninja"), pathEntries: [] }),
    /TN_NINJA_(MISSING|INVALID)/u,
  );
});

test("an explicit nonexistent ninja is rejected", () => {
  const root = tempDir("threenative-invalid-ninja-");
  const ndk = validNdk(root);
  assert.throws(
    () =>
      resolveBuildTools({
        ndkPath: ndk,
        ninjaPath: join(root, "does-not-exist"),
        gnPath: writeExecutable(join(root, "gn")),
      }),
    /TN_NINJA_(MISSING|INVALID)/u,
  );
});

test("an explicit non-executable GN file is rejected", () => {
  const root = tempDir("threenative-invalid-gn-");
  const ndk = validNdk(root);
  const ninja = writeExecutable(join(root, "ninja"));
  const gn = join(root, "gn");
  writeFileSync(gn, "not executable");
  assert.throws(
    () => resolveBuildTools({ ndkPath: ndk, ninjaPath: ninja, gnPath: gn }),
    /TN_GN_(MISSING|INVALID)/u,
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

test("a complete archive set without a receipt fails and is not mutated", () => {
  const root = tempDir("threenative-skia-cache-no-receipt-");
  const outDir = join(root, "skia", "out", "android-arm64");
  writeArchives(outDir);
  assert.throws(() => verifySkiaAndroidCache(root), /TN_SKIA_ANDROID_CACHE_INCOMPLETE/u);
  assert.equal(existsSync(join(outDir, ".threenative-skia-android.json")), false);
});

test("a malformed receipt fails closed without rewriting it", () => {
  const root = tempDir("threenative-skia-cache-malformed-");
  const outDir = join(root, "skia", "out", "android-arm64");
  writeArchives(outDir);
  const receiptPath = join(outDir, ".threenative-skia-android.json");
  writeFileSync(receiptPath, "{ malformed");
  assert.throws(() => verifySkiaAndroidCache(root), /TN_SKIA_ANDROID_RECEIPT_INVALID/u);
  assert.equal(readFileSync(receiptPath, "utf8"), "{ malformed");
});

test("build writes a hashed receipt only after Ninja succeeds", () => {
  const root = tempDir("threenative-skia-build-receipt-");
  const outDir = join(root, "skia", "out", "android-arm64");
  mkdirSync(join(root, "tools"), { recursive: true });
  mkdirSync(join(root, "skia"), { recursive: true });
  const tools = validTools(join(root, "tools"));
  assert.throws(
    () =>
      buildSkiaAndroid({
        sourceRoot: root,
        tools,
        pinRun: fixturePinRun(root),
        run: (command) => {
          if (command === tools.ninjaPath) throw new Error("ninja failed");
        },
      }),
    /ninja failed/u,
  );
  assert.equal(existsSync(join(outDir, ".threenative-skia-android.json")), false);
});

test("direct builds verify every source pin before invoking GN", () => {
  const root = tempDir("threenative-skia-build-pins-");
  mkdirSync(join(root, "tools"), { recursive: true });
  mkdirSync(join(root, "skia"), { recursive: true });
  const tools = validTools(join(root, "tools"));
  const pinCalls = [];
  const buildCalls = [];
  assert.throws(
    () =>
      buildSkiaAndroid({
        sourceRoot: root,
        tools,
        pinRun: (args) => {
          pinCalls.push(args);
          return fixturePinRun(root)(args);
        },
        run: (command) => {
          buildCalls.push(command);
          throw new Error("gn failed");
        },
      }),
    /gn failed/u,
  );
  assert.equal(pinCalls.length, 7);
  assert.equal(buildCalls.length, 1);
});

test("build captures the Skia source cwd and writes a receipt with archive hashes", () => {
  const root = tempDir("threenative-skia-build-cwd-");
  const { calls, outDir } = buildFixtureCache(root);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.cwd, join(root, "skia"));
  assert.equal(calls[1].options.cwd, join(root, "skia"));
  assert.deepEqual(calls[1].args.slice(0, 4), ["-C", outDir, "-j", "2"]);
  const receipt = JSON.parse(readFileSync(join(outDir, ".threenative-skia-android.json"), "utf8"));
  assert.equal(receipt.complete, true);
  assert.equal(receipt.archives["libskia.a"].sha256, createHash("sha256").update("skia:fixture").digest("hex"));
});

test("changed archive bytes invalidate an otherwise complete cache", () => {
  const root = tempDir("threenative-skia-cache-changed-");
  const { outDir } = buildFixtureCache(root);
  writeFileSync(join(outDir, "libskia.a"), "changed");
  assert.throws(() => verifySkiaAndroidCache(root), /TN_SKIA_ANDROID_ARCHIVE_CHANGED/u);
});

test("a pin-matching cache verifies repeatedly", () => {
  const root = tempDir("threenative-skia-cache-valid-");
  buildFixtureCache(root);
  const receipt = verifySkiaAndroidCache(root);
  assert.equal(receipt.arch, "arm64");
  assert.equal(receipt.complete, true);
  assert.equal(verifySkiaAndroidCache(root).complete, true);
});

test("staging copies the full include tree and all verified archives", () => {
  const root = tempDir("threenative-skia-stage-");
  const { outDir } = buildFixtureCache(root);
  const skiaSrc = join(root, "skia");
  for (const sub of ["core", "ports", "private", "gpu"]) {
    mkdirSync(join(skiaSrc, "include", sub), { recursive: true });
    writeFileSync(join(skiaSrc, "include", sub, `${sub}.h`), "fixture");
  }
  mkdirSync(join(skiaSrc, "modules", "skcms", "src"), { recursive: true });
  writeFileSync(join(skiaSrc, "modules", "skcms", "skcms.h"), "fixture skcms header");
  writeFileSync(join(skiaSrc, "modules", "skcms", "src", "skcms_internals.h"), "fixture skcms private header");
  const dest = join(root, "third_party", "skia-android", "build");
  const staged = stageSkiaAndroid({ sourceRoot: root, destDir: dest });
  assert.equal(staged.archives.length, REQUIRED_ARCHIVES.length);
  assert.equal(readFileSync(join(dest, "include", "include", "private", "private.h"), "utf8"), "fixture");
  assert.equal(readFileSync(join(dest, "include", "include", "gpu", "gpu.h"), "utf8"), "fixture");
  assert.equal(readFileSync(join(dest, "include", "modules", "skcms", "skcms.h"), "utf8"), "fixture skcms header");
  assert.equal(readFileSync(join(dest, "include", "modules", "skcms", "src", "skcms_internals.h"), "utf8"), "fixture skcms private header");
  assert.equal(existsSync(join(dest, "include", "include", "modules", "skcms")), false);
  for (const name of REQUIRED_ARCHIVES) {
    assert.ok(existsSync(join(dest, "android", "lib", "Release", "arm64-v8a", `lib${name}.a`)));
  }
  assert.ok(outDir);
});

test("staging does not mutate a destination when verification fails", () => {
  const root = tempDir("threenative-skia-stage-unverified-");
  const { outDir } = buildFixtureCache(root);
  writeFileSync(join(outDir, "libskia.a"), "changed");
  const dest = join(root, "third_party", "skia-android", "build");
  const sentinel = join(dest, "sentinel");
  mkdirSync(dest, { recursive: true });
  writeFileSync(sentinel, "keep");
  assert.throws(() => stageSkiaAndroid({ sourceRoot: root, destDir: dest }), /TN_SKIA_ANDROID_ARCHIVE_CHANGED/u);
  assert.equal(readFileSync(sentinel, "utf8"), "keep");
});

test("source pin verification checks Skia, GN, and every external pin", () => {
  const root = tempDir("threenative-skia-pins-");
  const expected = new Map([
    [join(root, "skia"), SKIA_COMMIT],
    [join(root, "gn-src"), GN_COMMIT],
    [join(root, "skia", "third_party", "externals", "expat"), DEP_PINS.expat],
    [join(root, "skia", "third_party", "externals", "freetype"), DEP_PINS.freetype],
    [join(root, "skia", "third_party", "externals", "libpng"), DEP_PINS.libpng],
    [join(root, "skia", "third_party", "externals", "wuffs"), DEP_PINS.wuffs],
    [join(root, "skia", "third_party", "externals", "zlib"), DEP_PINS.zlib],
  ]);
  const calls = [];
  const pins = verifySourcePins(root, {
    run: (args) => {
      calls.push(args);
      return expected.get(args[args.indexOf("-C") + 1]);
    },
  });
  assert.equal(calls.length, expected.size);
  assert.deepEqual(pins, { skiaCommit: SKIA_COMMIT, gnCommit: GN_COMMIT, dependencies: DEP_PINS });
  assert.throws(
    () =>
      verifySourcePins(root, {
        run: (args) => (args[args.indexOf("-C") + 1].endsWith("/zlib") ? "wrong" : expected.get(args[args.indexOf("-C") + 1])),
      }),
    /TN_SKIA_ANDROID_PIN_MISMATCH/u,
  );
});

test("Android dependency selection does not enable the source build by default", () => {
  const downloader = readFileSync(new URL("../scripts/download-deps.mjs", import.meta.url), "utf8");
  const match = downloader.match(/const androidDeps = \[([\s\S]*?)\];/u);
  assert.ok(match, "download-deps.mjs must declare androidDeps");
  assert.doesNotMatch(match[1], /skia-android/u);
  assert.match(downloader, /const sourceBuildDeps = \[.skia-android.\]/u);
});

test("staged-source entry point refuses missing source without fetching or mutating", async () => {
  const root = tempDir("threenative-skia-source-missing-");
  await assert.rejects(
    () => buildSkiaAndroidFromStagedSource({ sourceRoot: root }),
    /TN_SKIA_ANDROID_SOURCE_MISSING/u,
  );
});

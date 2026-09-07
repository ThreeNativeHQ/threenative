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
  GN_INITIAL_COMMIT,
  GN_INITIAL_TAG_OBJECT,
  NDK_VERSION,
  REQUIRED_ARCHIVES,
  SKIA_COMMIT,
  SOURCE_RECEIPT,
  buildSkiaAndroid,
  buildSkiaAndroidFromStagedSource,
  gnArgsFor,
  resolveBuildTools,
  provisionSkiaAndroidSource,
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

const SOURCE_PIN_FIXTURES = [
  { path: ["skia"], commit: SKIA_COMMIT, remote: "https://github.com/google/skia.git" },
  { path: ["gn-src"], commit: GN_COMMIT, remote: "https://gn.googlesource.com/gn" },
  {
    path: ["skia", "third_party", "externals", "expat"],
    commit: DEP_PINS.expat,
    remote: "https://chromium.googlesource.com/external/github.com/libexpat/libexpat.git",
  },
  {
    path: ["skia", "third_party", "externals", "freetype"],
    commit: DEP_PINS.freetype,
    remote: "https://chromium.googlesource.com/chromium/src/third_party/freetype2.git",
  },
  {
    path: ["skia", "third_party", "externals", "libpng"],
    commit: DEP_PINS.libpng,
    remote: "https://skia.googlesource.com/third_party/libpng.git",
  },
  {
    path: ["skia", "third_party", "externals", "wuffs"],
    commit: DEP_PINS.wuffs,
    remote: "https://skia.googlesource.com/external/github.com/google/wuffs-mirror-release-c.git",
  },
  {
    path: ["skia", "third_party", "externals", "zlib"],
    commit: DEP_PINS.zlib,
    remote: "https://chromium.googlesource.com/chromium/src/third_party/zlib",
  },
];

function provisionRunner({ root, partial = [], existing = [], dirty, failBootstrap = false } = {}) {
  const source = join(root, "source");
  const staging = `${source}.staging`;
  const gnOut = join(root, "gn-out");
  const ninjaPath = writeExecutable(join(root, "ninja"));
  const pythonPath = writeExecutable(join(root, "python3"));
  const states = new Map();
  const calls = { git: [], commands: [], events: [] };
  if (partial.length > 0) {
    mkdirSync(staging, { recursive: true });
    writeFileSync(
      join(staging, SOURCE_RECEIPT),
      `${JSON.stringify({
        version: 1,
        complete: false,
        repositories: SOURCE_PIN_FIXTURES.map(({ path, commit, remote }, index) => ({
          name: ["skia", "gn", "expat", "freetype", "libpng", "wuffs", "zlib"][index],
          path,
          commit,
          remote,
        })),
      }, null, 2)}\n`,
    );
  }
  for (const repo of partial) {
    const path = join(staging, ...repo.path);
    mkdirSync(path, { recursive: true });
    states.set(resolve(path), { remote: repo.remote, head: repo.commit, status: "", shallow: repo.shallow ?? false, history: !repo.shallow, tagObject: null, tagCommit: null });
  }
  for (const repo of existing) {
    const path = join(source, ...repo.path);
    mkdirSync(path, { recursive: true });
    states.set(resolve(path), { remote: repo.remote, head: repo.commit, status: "", shallow: false, history: true, tagObject: null, tagCommit: null });
  }
  if (dirty) {
    const path = join(source, ...dirty.path);
    mkdirSync(path, { recursive: true });
    states.set(resolve(path), { remote: dirty.remote, head: dirty.commit, status: " M dirty", shallow: false, history: true, tagObject: null, tagCommit: null });
  }
  const runGit = (args, options) => {
    calls.git.push({ args, options });
    calls.events.push({ kind: "git", args });
    if (args[0] === "init") {
      const path = resolve(args[1]);
      mkdirSync(path, { recursive: true });
      states.set(path, { remote: null, head: null, status: "", shallow: false, history: false, tagObject: null, tagCommit: null });
      return "";
    }
    const cIndex = args.indexOf("-C");
    const path = resolve(args[cIndex + 1]);
    const state = states.get(path);
    if (!state) throw new Error(`unknown fake repository ${path}`);
    const command = args[cIndex + 2];
    if (command === "rev-parse" && args.includes("--show-toplevel")) return path;
    if (command === "rev-parse" && args.includes("--is-shallow-repository")) return state.shallow ? "true" : "false";
    if (command === "rev-parse" && args.includes("refs/tags/initial-commit^{}")) {
      if (!state.tagCommit) throw new Error("GN tag missing");
      return state.tagCommit;
    }
    if (command === "rev-parse" && args.includes("refs/tags/initial-commit")) {
      if (!state.tagObject) throw new Error("GN tag missing");
      return state.tagObject;
    }
    if (command === "status") return state.status;
    if (command === "remote" && args[cIndex + 3] === "get-url") {
      if (!state.remote) throw new Error("origin missing");
      return state.remote;
    }
    if (command === "remote" && args[cIndex + 3] === "add") {
      state.remote = args[cIndex + 5];
      return "";
    }
    if (command === "fetch") {
      if (args.includes("--unshallow")) {
        state.shallow = false;
        state.history = true;
      }
      if (args.includes("refs/tags/initial-commit:refs/tags/initial-commit")) {
        state.tagObject = GN_INITIAL_TAG_OBJECT;
        state.tagCommit = GN_INITIAL_COMMIT;
      }
      if (!args.includes("--depth=1")) state.history = true;
      return "";
    }
    if (command === "checkout") {
      state.head = args.at(-1);
      return "";
    }
    if (command === "describe") {
      if (!state.history || !state.tagCommit) throw new Error("GN history missing");
      return `initial-commit-1-g${GN_COMMIT.slice(0, 12)}`;
    }
    if (command === "rev-parse") return state.head ?? (() => { throw new Error("HEAD missing"); })();
    throw new Error(`unexpected fake git command ${args.join(" ")}`);
  };
  const runCommand = (command, args, options) => {
    calls.commands.push({ command, args, options });
    calls.events.push({ kind: "command", command, args });
    if (failBootstrap) throw new Error("GN bootstrap failed");
    if (args.includes("--out-path")) {
      const outDir = args[args.indexOf("--out-path") + 1];
      mkdirSync(outDir, { recursive: true });
    }
    if (command === ninjaPath && args.at(-1) === "gn") writeExecutable(join(gnOut, "gn"));
  };
  return { source, staging, gnOut, ninjaPath, pythonPath, calls, runGit, runCommand };
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

test("staged-source entry point validates local prerequisites before provisioning", async () => {
  const root = tempDir("threenative-skia-source-missing-");
  await assert.rejects(
    () => buildSkiaAndroidFromStagedSource({ sourceRoot: root }),
    /TN_ANDROID_NDK_(MISSING|INVALID)/u,
  );
  assert.equal(existsSync(`${root}.staging`), false);
});

test("source provisioning fetches the exact seven repositories into an atomic staging root", () => {
  const root = tempDir("threenative-skia-source-provision-");
  const runner = provisionRunner({ root });
  const result = provisionSkiaAndroidSource({
    sourceRoot: runner.source,
    gnOutDir: runner.gnOut,
    ninjaPath: runner.ninjaPath,
    pythonPath: runner.pythonPath,
    runGit: runner.runGit,
    runCommand: runner.runCommand,
  });
  assert.equal(result.sourceRoot, resolve(runner.source));
  assert.equal(result.gnPath, join(runner.gnOut, "gn"));
  assert.equal(existsSync(runner.source), true);
  assert.equal(existsSync(runner.staging), false);
  const fetches = runner.calls.git.filter(({ args }) => args.includes("fetch") && args.at(-1) !== "refs/tags/initial-commit:refs/tags/initial-commit");
  assert.equal(fetches.length, SOURCE_PIN_FIXTURES.length);
  for (const repo of SOURCE_PIN_FIXTURES) {
    const repository = join(runner.staging, ...repo.path);
    const fetch = fetches.find(({ args }) => args.includes("-C") && resolve(args[args.indexOf("-C") + 1]) === resolve(repository));
    assert.ok(fetch, `missing fetch for ${repo.path.join("/")}`);
    assert.equal(fetch.args.at(-1), repo.commit);
    if (repo.path[0] === "gn-src") assert.equal(fetch.args.includes("--depth=1"), false);
    else assert.ok(fetch.args.includes("--depth=1"));
    assert.equal(fetch.options.timeout, 120_000);
  }
  assert.equal(runner.calls.git.some(({ args }) => args[0] === "clone"), false);
  assert.ok(runner.calls.git.some(({ args }) => args.includes("refs/tags/initial-commit:refs/tags/initial-commit")));
  assert.equal(runner.calls.commands[0].options.cwd, join(runner.staging, "gn-src"));
});

test("source provisioning resumes an interrupted owned staging root", () => {
  const root = tempDir("threenative-skia-source-resume-");
  const runner = provisionRunner({ root, partial: [SOURCE_PIN_FIXTURES[0]] });
  const result = provisionSkiaAndroidSource({
    sourceRoot: runner.source,
    gnOutDir: runner.gnOut,
    ninjaPath: runner.ninjaPath,
    pythonPath: runner.pythonPath,
    runGit: runner.runGit,
    runCommand: runner.runCommand,
  });
  assert.equal(result.sourceRoot, resolve(runner.source));
  const initialized = runner.calls.git
    .filter(({ args }) => args[0] === "init")
    .map(({ args }) => resolve(args[1]));
  assert.equal(initialized.includes(resolve(join(runner.staging, "skia"))), false);
  assert.equal(existsSync(runner.staging), false);
});

test("an owned shallow GN tree fetches tag ancestry before bootstrap", () => {
  const root = tempDir("threenative-skia-source-gn-history-");
  const runner = provisionRunner({ root, partial: [{ ...SOURCE_PIN_FIXTURES[1], shallow: true }] });
  provisionSkiaAndroidSource({
    sourceRoot: runner.source,
    gnOutDir: runner.gnOut,
    ninjaPath: runner.ninjaPath,
    pythonPath: runner.pythonPath,
    runGit: runner.runGit,
    runCommand: runner.runCommand,
  });
  const unshallow = runner.calls.git.findIndex(({ args }) => args.includes("--unshallow"));
  const tagFetch = runner.calls.git.findIndex(({ args }) => args.includes("refs/tags/initial-commit:refs/tags/initial-commit"));
  const bootstrap = runner.calls.events.findIndex(({ kind, args }) => kind === "command" && args.includes("build/gen.py"));
  const unshallowEvent = runner.calls.events.findIndex(({ kind, args }) => kind === "git" && args.includes("--unshallow"));
  const tagEvent = runner.calls.events.findIndex(({ kind, args }) => kind === "git" && args.includes("refs/tags/initial-commit:refs/tags/initial-commit"));
  assert.ok(unshallow >= 0);
  assert.ok(tagFetch > unshallow);
  assert.ok(bootstrap >= 0);
  assert.ok(unshallowEvent < tagEvent);
  assert.ok(tagEvent < bootstrap);
  for (const call of runner.calls.git.filter(({ args }) => args.includes("fetch") && args.at(-1) !== "refs/tags/initial-commit:refs/tags/initial-commit")) {
    if (call.args.includes(join(runner.staging, "gn-src"))) assert.equal(call.args.includes("--depth=1"), false);
    else assert.ok(call.args.includes("--depth=1"));
  }
});

test("bootstrap failure leaves only the owned staging root for a safe retry", () => {
  const root = tempDir("threenative-skia-source-interrupted-");
  const runner = provisionRunner({ root, failBootstrap: true });
  assert.throws(
    () =>
      provisionSkiaAndroidSource({
        sourceRoot: runner.source,
        gnOutDir: runner.gnOut,
        ninjaPath: runner.ninjaPath,
        pythonPath: runner.pythonPath,
        runGit: runner.runGit,
        runCommand: runner.runCommand,
      }),
    /GN bootstrap failed/u,
  );
  assert.equal(existsSync(runner.source), false);
  assert.equal(existsSync(runner.staging), true);
  assert.equal(JSON.parse(readFileSync(join(runner.staging, SOURCE_RECEIPT), "utf8")).complete, false);
});

test("an unowned staging directory is rejected without mutation", () => {
  const root = tempDir("threenative-skia-source-unowned-");
  const runner = provisionRunner({ root });
  mkdirSync(runner.staging, { recursive: true });
  writeFileSync(join(runner.staging, "unrelated.txt"), "keep");
  assert.throws(
    () =>
      provisionSkiaAndroidSource({
        sourceRoot: runner.source,
        gnOutDir: runner.gnOut,
        ninjaPath: runner.ninjaPath,
        pythonPath: runner.pythonPath,
        runGit: runner.runGit,
        runCommand: runner.runCommand,
      }),
    /TN_SKIA_ANDROID_SOURCE_STAGING_INVALID/u,
  );
  assert.equal(readFileSync(join(runner.staging, "unrelated.txt"), "utf8"), "keep");
  assert.equal(runner.calls.git.length, 0);
});

test("a dirty existing source tree is rejected without fetch or mutation", () => {
  const root = tempDir("threenative-skia-source-dirty-");
  const runner = provisionRunner({ root, dirty: SOURCE_PIN_FIXTURES[0] });
  assert.throws(
    () =>
      provisionSkiaAndroidSource({
        sourceRoot: runner.source,
        gnOutDir: runner.gnOut,
        ninjaPath: runner.ninjaPath,
        pythonPath: runner.pythonPath,
        runGit: runner.runGit,
        runCommand: runner.runCommand,
      }),
    /TN_SKIA_ANDROID_SOURCE_DIRTY/u,
  );
  assert.equal(runner.calls.git.some(({ args }) => args.includes("fetch")), false);
  assert.equal(existsSync(runner.staging), false);
});

test("wrong remote and wrong HEAD in an existing source tree fail closed", () => {
  for (const [index, code] of [["remote", "TN_SKIA_ANDROID_SOURCE_REMOTE"], ["head", "TN_SKIA_ANDROID_SOURCE_HEAD"]]) {
    const root = tempDir(`threenative-skia-source-wrong-${index}-`);
    const expected = SOURCE_PIN_FIXTURES[0];
    const wrong = {
      ...expected,
      ...(index === "remote" ? { remote: "https://example.invalid/wrong.git" } : { commit: "wrong-head" }),
    };
    const runner = provisionRunner({ root, existing: [wrong] });
    assert.throws(
      () =>
        provisionSkiaAndroidSource({
          sourceRoot: runner.source,
          gnOutDir: runner.gnOut,
          ninjaPath: runner.ninjaPath,
          pythonPath: runner.pythonPath,
          runGit: runner.runGit,
          runCommand: runner.runCommand,
        }),
      new RegExp(code, "u"),
    );
    assert.equal(runner.calls.git.some(({ args }) => args.includes("fetch")), false);
    assert.equal(existsSync(runner.staging), false);
  }
});

test("missing host C++ fails before creating a staging root", () => {
  const root = tempDir("threenative-skia-source-no-cxx-");
  const runner = provisionRunner({ root });
  assert.throws(
    () =>
      provisionSkiaAndroidSource({
        sourceRoot: runner.source,
        gnOutDir: runner.gnOut,
        ninjaPath: runner.ninjaPath,
        pythonPath: runner.pythonPath,
        pathEntries: [],
        runGit: runner.runGit,
        runCommand: runner.runCommand,
      }),
    /TN_HOST_CXX_MISSING/u,
  );
  assert.equal(existsSync(runner.staging), false);
  assert.equal(runner.calls.git.length, 0);
});

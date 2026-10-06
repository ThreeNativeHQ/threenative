#!/usr/bin/env node
// The Android arm64 build lane: which NDK links the corpus, and the GC runtime it links.
//
// The pinned toolchain emits aarch64 objects for `--mtriple=aarch64-linux-android`, but its own
// link step drives `ld.lld` with the host's search paths, so it cannot find crtbegin_dynamic.o,
// libc++, libunwind or the compiler-rt builtins. This module therefore does what the strict game
// build already does — compile objects with the pinned compiler, then link with a host driver —
// except that the driver is the NDK's own `aarch64-linux-android<api>-clang`, which carries its
// sysroot with it. Every ELF it produces is linked `-Wl,-z,max-page-size=16384`, because Android
// 15+ can run with 16 KB pages and a 4 KB-aligned library cannot be loaded at all.
//
// The GC runtime is the compiler's own (Boehm GC, pinned in the target file), cross-built here for
// arm64 with that NDK: the pinned archive ships an x86_64 `libgc.a` and no arm64 one, and a
// different collector would not be the runtime the Linux x64 target links.
//
// Everything this builds is cached outside the repository and keyed by the target's own pins.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifiedFetch } from "./provision.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TARGETS = path.join(HERE, "targets");

function named(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

/** The target file whose `triple` matches, so `--target <triple>` names no file of its own. */
export function findTarget(triple, dir = TARGETS) {
  let files;
  try {
    files = fs.readdirSync(dir).filter((file) => file.endsWith(".json"));
  } catch {
    return undefined;
  }
  for (const file of files.sort()) {
    const target = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    if (target.triple === triple) return { file: path.join(dir, file), target };
  }
  return undefined;
}

/** Newest of `versions` whose leading number is in `majors`; undefined when none is. */
export function pickNdkVersion(versions, majors) {
  const rank = (version) => version.split(/[.-]/u).map((part) => Number.parseInt(part, 10) || 0);
  const compare = (a, b) => {
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
      const difference = (b[index] ?? 0) - (a[index] ?? 0);
      if (difference !== 0) return difference;
    }
    return 0;
  };
  return versions
    .map((version) => ({ version, parts: rank(version) }))
    .filter(({ parts }) => majors.includes(parts[0]))
    .sort((a, b) => compare(a.parts, b.parts))
    .at(0)?.version;
}

/** Every directory that holds `ndk/<version>` trees, in the order the SDK documents. */
function ndkRoots(env) {
  const roots = [];
  for (const name of ["ANDROID_NDK_HOME", "ANDROID_NDK_ROOT", "ANDROID_NDK"]) {
    if (env[name]) roots.push(env[name]);
  }
  for (const name of ["ANDROID_HOME", "ANDROID_SDK_ROOT"]) {
    if (env[name]) roots.push(path.join(env[name], "ndk"));
  }
  roots.push(path.join(os.homedir(), "Android", "Sdk", "ndk"));
  return roots;
}

/**
 * The NDK this lane links with: the newest installed version whose major the target allows. A
 * directory whose `source.properties` disagrees with its name is a corrupted SDK, not a toolchain.
 */
export function resolveNdk(target, env = process.env) {
  const searched = [];
  for (const root of ndkRoots(env)) {
    let entries;
    try {
      entries = fs.readdirSync(root);
    } catch {
      searched.push(root);
      continue;
    }
    const version = pickNdkVersion(entries, target.ndk.majors);
    if (version === undefined) {
      searched.push(root);
      continue;
    }
    const dir = path.join(root, version);
    const revision = /Pkg\.Revision\s*=\s*(\S+)/u.exec(
      fs.readFileSync(path.join(dir, "source.properties"), "utf8"),
    )?.[1];
    if (revision !== version)
      throw named(
        "TN_NATIVE_TS_NDK",
        `${dir}/source.properties reports Pkg.Revision ${revision ?? "none"}, not ${version}`,
      );
    return { dir, version, bin: path.join(dir, "toolchains", "llvm", "prebuilt", hostTag(dir)) };
  }
  throw named(
    "TN_NATIVE_TS_NDK",
    `no NDK r${target.ndk.majors.join("/r")} under ${searched.join(", ")}`,
  );
}

function hostTag(ndkDir) {
  const prebuilt = path.join(ndkDir, "toolchains", "llvm", "prebuilt");
  return fs.readdirSync(prebuilt)[0];
}

function sha256File(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** Fetch each pinned archive, prove its checksum, and unpack it once. */
async function fetchGcSources(sources, { log }) {
  for (const source of sources) {
    if (!fs.existsSync(source.archive)) {
      log(`fetching ${path.basename(source.dir)}`);
      fs.mkdirSync(path.dirname(source.archive), { recursive: true });
      await verifiedFetch(source.url, source.sha256, source.archive);
    }
    const actual = sha256File(source.archive);
    if (actual !== source.sha256)
      throw named(
        "TN_NATIVE_TS_CHECKSUM",
        `${path.basename(source.archive)}: pinned sha256 ${source.sha256}, actual ${actual}`,
      );
    if (fs.existsSync(path.join(source.dir, "CMakeLists.txt"))) continue;
    fs.mkdirSync(source.dir, { recursive: true });
    const untar = spawnSync(
      "tar",
      ["-xzf", source.archive, "-C", source.dir, "--strip-components=1"],
      {
        stdio: "inherit",
      },
    );
    if (untar.status !== 0)
      throw named("TN_NATIVE_TS_GC", `tar exited ${untar.status} for ${source.archive}`);
  }
}

/**
 * The GC runtime for arm64, cross-built from the target's pinned sources with the pinned NDK and
 * cached by that pin. A cached archive whose tarball no longer matches is rebuilt, never trusted.
 */
export async function ensureAndroidGc(target, { ndk, env = process.env, log = () => {} } = {}) {
  const base =
    env.TN_NATIVE_TS_ANDROID_CACHE ??
    path.join(os.homedir(), ".cache", "threenative", "android-target");
  const cache = path.join(base, `${target.gc.version}-${target.abi}`);
  const src = path.join(cache, "src");
  const build = path.join(cache, "build");
  const archive = path.join(build, "libgc.a");
  if (fs.existsSync(archive)) return { archive, cache };

  const sources = [
    {
      version: target.gc.version,
      url: target.gc.url,
      sha256: target.gc.sha256,
      dir: path.join(src, `gc-${target.gc.version}`),
      archive: path.join(cache, path.basename(new URL(target.gc.url).pathname)),
    },
    {
      version: target.gc.libatomicOps.version,
      url: target.gc.libatomicOps.url,
      sha256: target.gc.libatomicOps.sha256,
      dir: path.join(src, `libatomic_ops-${target.gc.libatomicOps.version}`),
      archive: path.join(cache, path.basename(new URL(target.gc.libatomicOps.url).pathname)),
    },
  ];
  await fetchGcSources(sources, { log });

  // Boehm's own release recipe puts libatomic_ops inside the gc source tree.
  const atomicOps = path.join(sources[0].dir, "libatomic_ops");
  if (!fs.existsSync(atomicOps)) {
    fs.mkdirSync(atomicOps, { recursive: true });
    for (const entry of fs.readdirSync(sources[1].dir))
      fs.cpSync(path.join(sources[1].dir, entry), path.join(atomicOps, entry), { recursive: true });
  }

  log(`cross-building ${target.gc.name} ${target.gc.version} for ${target.abi}`);
  fs.mkdirSync(build, { recursive: true });
  const configure = spawnSync(
    "cmake",
    [
      sources[0].dir,
      "-G",
      "Ninja",
      `-DCMAKE_TOOLCHAIN_FILE=${path.join(ndk.dir, "build", "cmake", "android.toolchain.cmake")}`,
      `-DANDROID_ABI=${target.abi}`,
      `-DANDROID_PLATFORM=android-${target.apiLevel}`,
      "-DCMAKE_BUILD_TYPE=Release",
      "-DBUILD_SHARED_LIBS=OFF",
      "-DCMAKE_POSITION_INDEPENDENT_CODE=ON",
      "-Denable_threads=ON",
      "-Denable_cplusplus=OFF",
      "-Wno-dev",
    ],
    { cwd: build, stdio: "inherit" },
  );
  if (configure.status !== 0)
    throw named(
      "TN_NATIVE_TS_GC",
      `cmake configure exited ${configure.status} for ${target.gc.name}`,
    );
  const compiled = spawnSync("cmake", ["--build", ".", "-j", "8"], {
    cwd: build,
    stdio: "inherit",
  });
  if (compiled.status !== 0 || !fs.existsSync(archive))
    throw named("TN_NATIVE_TS_GC", `cmake --build exited ${compiled.status} without ${archive}`);
  return { archive, cache };
}

/**
 * The link step for the target: the NDK's own arm64 driver, the cross-built GC, and the page size
 * every Android 15+ device needs. Returns the first error line, or undefined when it linked.
 */
export function androidLinker(target, { ndk, gc, env = process.env } = {}) {
  const driver = path.join(ndk.bin, "bin", `aarch64-linux-android${target.apiLevel}-clang`);
  return (objects, out) => {
    const link = spawnSync(
      driver,
      ["-shared", "-o", out, ...objects, gc.archive, `-Wl,-z,max-page-size=${target.maxPageSize}`],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env },
    );
    const output = `${link.stdout ?? ""}${link.stderr ?? ""}`;
    if (link.status === 0 && !output.includes("error:")) return undefined;
    return (
      output.split("\n").find((line) => line.includes("error:")) ?? `linker exited ${link.status}`
    );
  };
}

#!/usr/bin/env node
// The Android arm64 build lane: which NDK Perry links with, and which cross runtime it links.
//
// Decision 11: Perry compiles the cross target itself, so this lane no longer emits objects for a
// host linker to combine. It resolves the NDK, provisions the pinned Perry cross runtime for the
// target triple, and reports how Perry is invoked. Perry links the target's own archives — runtime,
// stdlib and UI — so the page size comes from the NDK driver Perry invokes.
//
// Everything this builds is cached outside the repository and keyed by the target's own pins.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLock, provisionCross, readRuntimeStamp } from "./provision.mjs";

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

/** The `--target` value Perry takes for a triple in targets/. */
export function perryTarget(triple) {
  switch (triple) {
    case "aarch64-linux-android":
      return "android";
    case "x86_64-linux-android":
      return "android-x86_64";
    case "aarch64-apple-ios":
      return "ios";
    default:
      return undefined;
  }
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

/**
 * The cross runtime Perry links a target with, plus the NDK it drives. A triple the lock pins under
 * `crossBuilds` comes from build-cross-runtime.mjs and is checked against the pinned stamp here, so
 * a missing or stale build is this lane's own named failure rather than a Perry link error.
 */
export async function ensureAndroidRuntime(
  target,
  { ndk, env = process.env, log = () => {} } = {},
) {
  const lock = loadLock();
  const provisioned = await provisionCross(target.triple, { lock, env, log });
  const stamp = readRuntimeStamp(path.join(provisioned.dir, "libperry_runtime.a"));
  return { ...provisioned, ndk, stamps: stamp === undefined ? undefined : { build: stamp.build } };
}

#!/usr/bin/env node

// Bounded, reproducible Skia source build for Android arm64 (Canvas2D).
// The source tree is deliberately staged by the caller; this helper never fetches it.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  constants as fsConstants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");

export const SKIA_COMMIT = "f2bc5d570a269a5541475e122c4d4c405a314b2a";
export const GN_COMMIT = "4f6a76b64b8279e98004f541f8e136307efe5e01";
export const NDK_VERSION = "27.1.12297006";
export const SUPPORTED_ARCHES = Object.freeze(["arm64"]);
export const REQUIRED_ARCHIVES = Object.freeze([
  "skia",
  "freetype2",
  "png",
  "zlib",
  "expat",
  "skcms",
  "wuffs",
  "cpu-features",
]);
export const DEP_PINS = Object.freeze({
  expat: "8e49998f003d693213b538ef765814c7d21abada",
  freetype: "b91f75bd02db43b06d634591eb286d3eb0ce3b65",
  libpng: "4e3f57d50f552841550a36eabbb3fbcecacb7750",
  wuffs: "e3f919ccfe3ef542cfc983a82146070258fb57f8",
  zlib: "646b7f569718921d7d4b5b8e22572ff6c76f2596",
});
export const BUILD_RECEIPT = ".threenative-skia-android.json";

const DEP_PATHS = Object.freeze({
  expat: ["skia", "third_party", "externals", "expat"],
  freetype: ["skia", "third_party", "externals", "freetype"],
  libpng: ["skia", "third_party", "externals", "libpng"],
  wuffs: ["skia", "third_party", "externals", "wuffs"],
  zlib: ["skia", "third_party", "externals", "zlib"],
});

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isExecutableFile(path) {
  if (!path) return false;
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function executableNames(name) {
  return process.platform === "win32" ? [name, `${name}.exe`] : [name];
}

function findOnPath(name, pathEntries) {
  for (const dir of pathEntries) {
    for (const executable of executableNames(name)) {
      const candidate = join(dir, executable);
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  return null;
}

function ndkHostTags() {
  if (process.platform === "darwin") {
    return process.arch === "arm64" ? ["darwin-arm64", "darwin-x86_64"] : ["darwin-x86_64"];
  }
  if (process.platform === "win32") return ["windows-x86_64"];
  return ["linux-x86_64"];
}

function ndkBin(ndkPath) {
  for (const hostTag of ndkHostTags()) {
    const bin = join(ndkPath, "toolchains", "llvm", "prebuilt", hostTag, "bin");
    if (!isDirectory(bin)) continue;
    if (findOnPath("clang", [bin])) return bin;
  }
  return null;
}

function findNdk(androidHome) {
  if (!androidHome) return null;
  const pinned = join(androidHome, "ndk", NDK_VERSION);
  return ndkBin(pinned) ? pinned : null;
}

function validateNdk(ndkPath) {
  if (!ndkPath || !isDirectory(ndkPath)) return false;
  try {
    const sourceProperties = readFileSync(join(ndkPath, "source.properties"), "utf8");
    const revision = sourceProperties.match(/^Pkg\.Revision\s*=\s*([^\s#]+)/mu)?.[1];
    return revision === NDK_VERSION && Boolean(ndkBin(ndkPath));
  } catch {
    return false;
  }
}

function optionProvided(options, name) {
  return options[name] !== undefined && options[name] !== null;
}

function resolveNdk(options, androidHome) {
  const explicit = optionProvided(options, "ndkPath");
  const ndkPath = options.ndkPath ?? findNdk(androidHome);
  if (validateNdk(ndkPath)) return resolve(ndkPath);
  const code = explicit ? "TN_ANDROID_NDK_INVALID" : "TN_ANDROID_NDK_MISSING";
  throw new Error(`${code}: expected NDK ${NDK_VERSION} with an LLVM clang toolchain at ${ndkPath ?? androidHome ?? "(no ANDROID_HOME)"}`);
}

function resolveExecutable(options, name, searchPaths) {
  const optionName = `${name}Path`;
  const explicit = optionProvided(options, optionName);
  const path = options[optionName] ?? findOnPath(name, searchPaths);
  if (isExecutableFile(path)) return resolve(path);
  const code = explicit ? `TN_${name.toUpperCase()}_INVALID` : `TN_${name.toUpperCase()}_MISSING`;
  const fallback = name === "ninja" ? "ninja not on PATH or in .runtime/tools-venv/bin" : "gn not on PATH; stage the pinned gn-src build";
  throw new Error(`${code}: ${path ?? fallback}`);
}

// Validate NDK + Ninja + GN. Never falls back silently when an explicit path is invalid.
export function resolveBuildTools(options = {}) {
  const androidHome = options.androidHome ?? process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? null;
  const ndkPath = resolveNdk(options, androidHome);
  const pathEntries = options.pathEntries ?? (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const ninjaPath = resolveExecutable(options, "ninja", [join(packageRoot, ".runtime", "tools-venv", "bin"), ...pathEntries]);
  const gnPath = resolveExecutable(options, "gn", pathEntries);
  return { ndkPath, ninjaPath, gnPath };
}

// Proven probe args minus android_ndk_version, skia_use_gpu, skia_enable_sksl.
export function gnArgsFor({ ndkPath, arch = "arm64" } = {}) {
  if (!SUPPORTED_ARCHES.includes(arch)) {
    throw new Error(`TN_SKIA_ANDROID_ARCH: unsupported arch ${arch}; supported: ${SUPPORTED_ARCHES.join(", ")}`);
  }
  return [
    'target_os="android"',
    'target_cpu="arm64"',
    `ndk="${ndkPath}"`,
    "skia_use_angle=false",
    "skia_use_dawn=false",
    "skia_use_vulkan=false",
    "skia_use_metal=false",
    "skia_use_direct3d=false",
    "skia_use_gl=false",
    "skia_use_expat=true",
    "skia_use_system_expat=false",
    "skia_use_freetype=true",
    "skia_use_system_freetype2=false",
    "skia_enable_fontmgr_android=true",
    "skia_enable_fontmgr_android_ndk=false",
    "skia_use_fontconfig=false",
    "skia_use_harfbuzz=false",
    "skia_use_icu=false",
    "skia_use_libjpeg_turbo_decode=false",
    "skia_use_libjpeg_turbo_encode=false",
    "skia_use_libpng_decode=true",
    "skia_use_system_libpng=false",
    "skia_use_libpng_encode=false",
    "skia_use_libwebp_decode=false",
    "skia_use_libwebp_encode=false",
    "skia_use_zlib=true",
    "skia_use_system_zlib=false",
    "skia_use_lua=false",
    "skia_enable_pdf=false",
    "skia_enable_skottie=false",
    "skia_enable_svg=false",
    "skia_enable_skparagraph=false",
    "is_official_build=true",
    "is_debug=false",
    "is_component_build=false",
  ].join(" ");
}

export function skiaOutDir(sourceRoot, arch = "arm64") {
  if (!SUPPORTED_ARCHES.includes(arch)) {
    throw new Error(`TN_SKIA_ANDROID_ARCH: unsupported arch ${arch}; supported: ${SUPPORTED_ARCHES.join(", ")}`);
  }
  return join(resolve(sourceRoot), "skia", "out", `android-${arch}`);
}

function archiveFile(outDir, name) {
  return join(outDir, `lib${name}.a`);
}

function archiveRecords(outDir) {
  const records = {};
  const missing = [];
  for (const name of REQUIRED_ARCHIVES) {
    const path = archiveFile(outDir, name);
    try {
      const stats = statSync(path);
      if (!stats.isFile() || stats.size === 0) {
        missing.push(`lib${name}.a`);
        continue;
      }
      records[`lib${name}.a`] = {
        sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
        size: stats.size,
      };
    } catch {
      missing.push(`lib${name}.a`);
    }
  }
  if (missing.length > 0) {
    throw new Error(`TN_SKIA_ANDROID_CACHE_INCOMPLETE: missing or empty ${missing.join(", ")} in ${outDir}; build must complete before staging`);
  }
  return records;
}

function readReceipt(outDir) {
  const receiptPath = join(outDir, BUILD_RECEIPT);
  if (!existsSync(receiptPath)) return null;
  try {
    return JSON.parse(readFileSync(receiptPath, "utf8"));
  } catch (error) {
    throw new Error(`TN_SKIA_ANDROID_RECEIPT_INVALID: cannot parse ${receiptPath}`, { cause: error });
  }
}

function expectedReceipt(options, arch) {
  return {
    skiaCommit: options.skiaCommit ?? SKIA_COMMIT,
    gnCommit: options.gnCommit ?? GN_COMMIT,
    ndk: options.ndk ?? NDK_VERSION,
    arch,
  };
}

function validateReceipt(receipt, expected, actualArchives, receiptPath) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt) || receipt.version !== 1 || receipt.complete !== true) {
    throw new Error(`TN_SKIA_ANDROID_RECEIPT_INVALID: incomplete receipt at ${receiptPath}`);
  }
  for (const key of ["skiaCommit", "gnCommit", "ndk", "arch"]) {
    if (receipt[key] !== expected[key]) {
      throw new Error(`TN_SKIA_ANDROID_PIN_MISMATCH: receipt ${key} is ${receipt[key]}, expected ${expected[key]}; rebuild the staged source`);
    }
  }
  if (!receipt.archives || typeof receipt.archives !== "object" || Array.isArray(receipt.archives)) {
    throw new Error(`TN_SKIA_ANDROID_RECEIPT_INVALID: archive hashes missing from ${receiptPath}`);
  }
  for (const file of Object.keys(actualArchives)) {
    const expectedArchive = receipt.archives[file];
    const actualArchive = actualArchives[file];
    if (!expectedArchive || expectedArchive.sha256 !== actualArchive.sha256 || expectedArchive.size !== actualArchive.size) {
      throw new Error(`TN_SKIA_ANDROID_ARCHIVE_CHANGED: ${file} does not match the build receipt; rebuild before staging`);
    }
  }
  for (const file of Object.keys(receipt.archives)) {
    if (!actualArchives[file]) {
      throw new Error(`TN_SKIA_ANDROID_RECEIPT_INVALID: unexpected archive ${file} in ${receiptPath}`);
    }
  }
}

function writeBuildReceipt(outDir, expected) {
  const archives = archiveRecords(outDir);
  const receipt = { version: 1, ...expected, complete: true, archives };
  writeFileSync(join(outDir, BUILD_RECEIPT), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

// All eight archives plus a pin-matching, hash-bearing receipt are required.
export function verifySkiaAndroidCache(sourceRoot, options = {}) {
  const arch = options.arch ?? "arm64";
  const outDir = skiaOutDir(sourceRoot, arch);
  const actualArchives = archiveRecords(outDir);
  const receiptPath = join(outDir, BUILD_RECEIPT);
  const receipt = readReceipt(outDir);
  if (!receipt) {
    throw new Error(`TN_SKIA_ANDROID_CACHE_INCOMPLETE: build receipt missing at ${receiptPath}; rebuild the staged source`);
  }
  const expected = expectedReceipt(options, arch);
  validateReceipt(receipt, expected, actualArchives, receiptPath);
  return { ...receipt, complete: true };
}

function gitHead(run, repository) {
  return String(run(["-C", repository, "rev-parse", "HEAD"])).trim();
}

// Refuse a source tree whose Skia, GN, or external dependency HEAD differs from the proven build.
export function verifySourcePins(sourceRoot, options = {}) {
  const root = resolve(sourceRoot);
  const run = options.run ?? ((args) => execFileSync("git", args, { encoding: "utf8" }));
  const skiaCommit = gitHead(run, join(root, "skia"));
  if (skiaCommit !== SKIA_COMMIT) {
    throw new Error(`TN_SKIA_ANDROID_PIN_MISMATCH: skia HEAD is ${skiaCommit}, expected ${SKIA_COMMIT}`);
  }
  const gnCommit = gitHead(run, join(root, "gn-src"));
  if (gnCommit !== GN_COMMIT) {
    throw new Error(`TN_SKIA_ANDROID_PIN_MISMATCH: gn-src HEAD is ${gnCommit}, expected ${GN_COMMIT}`);
  }
  const dependencies = {};
  for (const [name, pin] of Object.entries(DEP_PINS)) {
    const commit = gitHead(run, join(root, ...DEP_PATHS[name]));
    if (commit !== pin) {
      throw new Error(`TN_SKIA_ANDROID_PIN_MISMATCH: ${name} HEAD is ${commit}, expected ${pin}`);
    }
    dependencies[name] = commit;
  }
  return { skiaCommit, gnCommit, dependencies };
}

function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    const source = join(from, entry);
    const target = join(to, entry);
    if (statSync(source).isDirectory()) copyTree(source, target);
    else copyFileSync(source, target);
  }
}

// Stage only after the cache has been fully verified. Preserve the source include tree as-is.
export function stageSkiaAndroid({ sourceRoot, destDir, arch = "arm64" } = {}) {
  const root = resolve(sourceRoot);
  verifySkiaAndroidCache(root, { arch });
  const sourceInclude = join(root, "skia", "include");
  if (!isDirectory(sourceInclude)) throw new Error(`TN_SKIA_ANDROID_STAGE: missing headers at ${sourceInclude}`);
  const sourceSkcms = join(root, "skia", "modules", "skcms");
  if (!isDirectory(sourceSkcms)) throw new Error(`TN_SKIA_ANDROID_STAGE: missing modules/skcms at ${sourceSkcms}`);
  const dest = resolve(destDir);
  const includeDest = join(dest, "include", "include");
  const libDest = join(dest, "android", "lib", "Release", "arm64-v8a");
  copyTree(sourceInclude, includeDest);
  copyTree(sourceSkcms, join(dest, "include", "modules", "skcms"));
  mkdirSync(libDest, { recursive: true });
  const staged = [];
  for (const name of REQUIRED_ARCHIVES) {
    copyFileSync(archiveFile(skiaOutDir(root, arch), name), join(libDest, `lib${name}.a`));
    staged.push(`lib${name}.a`);
  }
  return { includeDir: includeDest, libDir: libDest, archives: staged };
}

// Run gn gen + ninja for the bounded archive set. Injectable run for tests.
export function buildSkiaAndroid({ sourceRoot, tools, arch = "arm64", jobs = 2, pinRun, run } = {}) {
  const root = resolve(sourceRoot);
  const skiaSource = join(root, "skia");
  if (!isDirectory(skiaSource)) throw new Error(`TN_SKIA_ANDROID_SOURCE_MISSING: expected Skia source at ${skiaSource}`);
  if (!Number.isInteger(jobs) || jobs < 1) throw new Error(`TN_SKIA_ANDROID_JOBS: expected a positive integer, received ${jobs}`);
  verifySourcePins(root, pinRun ? { run: pinRun } : {});
  const resolved = tools ?? resolveBuildTools();
  const args = gnArgsFor({ ndkPath: resolved.ndkPath, arch });
  const outDir = skiaOutDir(root, arch);
  const exec = run ?? ((command, commandArgs, options) => execFileSync(command, commandArgs, { stdio: "inherit", ...options }));
  const commandOptions = { cwd: skiaSource };
  exec(resolved.gnPath, ["gen", outDir, `--args=${args}`], commandOptions);
  exec(resolved.ninjaPath, ["-C", outDir, "-j", String(jobs), ...REQUIRED_ARCHIVES.map((name) => `lib${name}.a`)], commandOptions);
  writeBuildReceipt(outDir, { skiaCommit: SKIA_COMMIT, gnCommit: GN_COMMIT, ndk: NDK_VERSION, arch });
  return verifySkiaAndroidCache(root, { arch });
}

// --only skia-android entry point for download-deps.mjs. No source fetch is attempted.
export async function buildSkiaAndroidFromStagedSource({ sourceRoot, destDir, jobs = 2 } = {}) {
  const source = resolve(sourceRoot ?? join(packageRoot, ".skia-android-src"));
  const dest = resolve(destDir ?? join(packageRoot, "third_party", "skia-android", "build"));
  if (!isDirectory(join(source, "skia")) || !isDirectory(join(source, "gn-src"))) {
    throw new Error(`TN_SKIA_ANDROID_SOURCE_MISSING: stage Skia at ${join(source, "skia")} and GN at ${join(source, "gn-src")}; no network fetch is attempted`);
  }
  const tools = resolveBuildTools();
  try {
    verifySkiaAndroidCache(source);
    console.log(`skia-android cache hit at ${skiaOutDir(source)}`);
  } catch (error) {
    if (!String(error?.message ?? error).includes("TN_SKIA_ANDROID_CACHE_INCOMPLETE")) throw error;
    console.log("skia-android cache incomplete; rebuilding the bounded archive set");
    buildSkiaAndroid({ sourceRoot: source, tools, jobs });
  }
  const staged = stageSkiaAndroid({ sourceRoot: source, destDir: dest });
  console.log(`Staged ${staged.archives.length} archives to ${staged.libDir}`);
  return true;
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

async function main() {
  const args = process.argv.slice(2);
  const source = valueAfter(args, "--source") ?? join(packageRoot, ".skia-android-src");
  const dest = valueAfter(args, "--dest") ?? join(packageRoot, "third_party", "skia-android", "build");
  const jobsValue = valueAfter(args, "--jobs");
  await buildSkiaAndroidFromStagedSource({
    sourceRoot: source,
    destDir: dest,
    ...(jobsValue === null ? {} : { jobs: Number(jobsValue) }),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

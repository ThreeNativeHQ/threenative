#!/usr/bin/env node
// Bounded reproducible Skia source build for Android arm64 (Canvas2D).
// Reconstructs the proven probe (Skia f2bc5d57, NDK 27, GN + Ninja) into
// third_party/skia-android/build/{include,android/lib/Release/arm64-v8a}.
// Only Ninja-proven externals are reconstructed (expat, freetype, libpng,
// wuffs, zlib); skcms and cpu-features are in-tree. Pins are immutable.
// No network fetch here — the parent stages the source tree.

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");

export const SKIA_COMMIT = "f2bc5d570a269a5541475e122c4d4c405a314b2a";
export const GN_COMMIT = "4f6a76b64b8279e98004f541f8e136307efe5e01";
export const NDK_VERSION = "27.1.12297006";
export const SUPPORTED_ARCHES = Object.freeze(["arm64"]);
export const REQUIRED_ARCHIVES = Object.freeze([
  "skia", "freetype2", "png", "zlib", "expat", "skcms", "wuffs", "cpu-features",
]);
export const DEP_PINS = Object.freeze({
  expat: "8e49998f003d693213b538ef765814c7d21abada",
  freetype: "b91f75bd02db43b06d634591eb286d3eb0ce3b65",
  libpng: "4e3f57d50f552841550a36eabbb3fbcecacb7750",
  wuffs: "e3f919ccfe3ef542cfc983a82146070258fb57f8",
  zlib: "646b7f569718921d7d4b5b8e22572ff6c76f2596",
});

function findOnPath(name, pathEntries) {
  for (const dir of pathEntries) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function findNdk(androidHome) {
  if (!androidHome) return null;
  const pinned = join(androidHome, "ndk", NDK_VERSION);
  const marker = join(pinned, "toolchains", "llvm", "prebuilt", "linux-x86_64", "bin");
  return existsSync(marker) ? pinned : null;
}

// Validate NDK + ninja + gn. Never falls back silently.
export function resolveBuildTools(options = {}) {
  const androidHome = options.androidHome ?? process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? null;
  const ndkPath = options.ndkPath ?? findNdk(androidHome);
  if (!ndkPath || !existsSync(ndkPath)) {
    throw new Error(`TN_ANDROID_NDK_MISSING: NDK ${NDK_VERSION} not found under ${androidHome ?? "(no ANDROID_HOME)"}; install it, no fallback is attempted`);
  }
  const pathEntries = options.pathEntries ?? (process.env.PATH ?? "").split(":");
  const ninjaPath = options.ninjaPath ?? findOnPath("ninja", [join(packageRoot, ".runtime", "tools-venv", "bin"), ...pathEntries]);
  if (!ninjaPath) throw new Error("TN_NINJA_MISSING: ninja not on PATH or in .runtime/tools-venv/bin");
  const gnPath = options.gnPath ?? findOnPath("gn", pathEntries);
  if (!gnPath) throw new Error("TN_GN_MISSING: gn not on PATH; stage the pinned gn-src build");
  return { ndkPath, ninjaPath, gnPath };
}

// Proven probe args minus android_ndk_version, skia_use_gpu, skia_enable_sksl.
export function gnArgsFor({ ndkPath, arch = "arm64" } = {}) {
  if (!SUPPORTED_ARCHES.includes(arch)) {
    throw new Error(`TN_SKIA_ANDROID_ARCH: unsupported arch ${arch}; supported: ${SUPPORTED_ARCHES.join(", ")}`);
  }
  return [
    'target_os="android"', 'target_cpu="arm64"', `ndk="${ndkPath}"`,
    "skia_use_angle=false", "skia_use_dawn=false", "skia_use_vulkan=false",
    "skia_use_metal=false", "skia_use_direct3d=false", "skia_use_gl=false",
    "skia_use_expat=true", "skia_use_system_expat=false",
    "skia_use_freetype=true", "skia_use_system_freetype2=false",
    "skia_enable_fontmgr_android=true", "skia_enable_fontmgr_android_ndk=false",
    "skia_use_fontconfig=false", "skia_use_harfbuzz=false", "skia_use_icu=false",
    "skia_use_libjpeg_turbo_decode=false", "skia_use_libjpeg_turbo_encode=false",
    "skia_use_libpng_decode=true", "skia_use_system_libpng=false", "skia_use_libpng_encode=false",
    "skia_use_libwebp_decode=false", "skia_use_libwebp_encode=false",
    "skia_use_zlib=true", "skia_use_system_zlib=false", "skia_use_lua=false",
    "skia_enable_pdf=false", "skia_enable_skottie=false", "skia_enable_svg=false",
    "skia_enable_skparagraph=false",
    "is_official_build=true", "is_debug=false", "is_component_build=false",
  ].join(" ");
}

export function skiaOutDir(sourceRoot, arch = "arm64") {
  return join(resolve(sourceRoot), "skia", "out", `android-${arch}`);
}

function readReceipt(outDir) {
  const receiptPath = join(outDir, ".threenative-skia-android.json");
  if (!existsSync(receiptPath)) return null;
  try { return JSON.parse(readFileSync(receiptPath, "utf8")); } catch { return null; }
}

function missingArchives(outDir) {
  return REQUIRED_ARCHIVES.filter((name) => !existsSync(join(outDir, `lib${name}.a`)));
}

// All eight archives plus a pin-matching receipt, else repair/failure.
export function verifySkiaAndroidCache(sourceRoot, options = {}) {
  const arch = options.arch ?? "arm64";
  const skiaCommit = options.skiaCommit ?? SKIA_COMMIT;
  const outDir = skiaOutDir(sourceRoot, arch);
  const missing = existsSync(outDir) ? missingArchives(outDir) : [...REQUIRED_ARCHIVES];
  if (missing.length > 0) {
    throw new Error(`TN_SKIA_ANDROID_CACHE_INCOMPLETE: missing ${missing.map((n) => `lib${n}.a`).join(", ")} in ${outDir}; delete the tree and rebuild`);
  }
  const expected = { skiaCommit, gnCommit: GN_COMMIT, ndk: NDK_VERSION, arch };
  const receipt = readReceipt(outDir);
  if (!receipt && skiaCommit !== SKIA_COMMIT) {
    throw new Error(`TN_SKIA_ANDROID_PIN_MISMATCH: no receipt in ${outDir} and requested skia pin is ${skiaCommit}, expected ${SKIA_COMMIT}`);
  }
  if (!receipt) {
    const fresh = { ...expected, complete: true };
    writeFileSync(join(outDir, ".threenative-skia-android.json"), `${JSON.stringify(fresh, null, 2)}\n`);
    return fresh;
  }
  for (const key of ["skiaCommit", "gnCommit", "ndk", "arch"]) {
    if (receipt[key] !== expected[key]) {
      throw new Error(`TN_SKIA_ANDROID_PIN_MISMATCH: receipt ${key} is ${receipt[key]}, expected ${expected[key]}; delete the tree and rebuild`);
    }
  }
  return { ...receipt, complete: true };
}

// Refuse a source tree whose HEAD differs from the proven build.
export function verifySourcePins(sourceRoot, options = {}) {
  const run = options.run ?? ((args) => execFileSync("git", args, { encoding: "utf8" }).trim());
  const head = run(["-C", join(resolve(sourceRoot), "skia"), "rev-parse", "HEAD"]);
  if (head !== SKIA_COMMIT) throw new Error(`TN_SKIA_ANDROID_PIN_MISMATCH: skia HEAD is ${head}, expected ${SKIA_COMMIT}`);
  return { skiaCommit: head };
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

// Stage include/core + include/ports headers and all eight archives.
export function stageSkiaAndroid({ sourceRoot, destDir, arch = "arm64" } = {}) {
  const root = resolve(sourceRoot);
  verifySkiaAndroidCache(root, { arch });
  const dest = resolve(destDir);
  const includeDest = join(dest, "include", "include");
  const libDest = join(dest, "android", "lib", "Release", "arm64-v8a");
  for (const sub of ["core", "ports"]) {
    const from = join(root, "skia", "include", sub);
    if (!existsSync(from)) throw new Error(`TN_SKIA_ANDROID_STAGE: missing headers at ${from}`);
    copyTree(from, join(includeDest, sub));
  }
  mkdirSync(libDest, { recursive: true });
  const staged = [];
  for (const name of REQUIRED_ARCHIVES) {
    copyFileSync(join(skiaOutDir(root, arch), `lib${name}.a`), join(libDest, `lib${name}.a`));
    staged.push(`lib${name}.a`);
  }
  return { includeDir: includeDest, libDir: libDest, archives: staged };
}

// Run gn gen + ninja for the bounded archive set. Injectable run for tests.
export function buildSkiaAndroid({ sourceRoot, tools, arch = "arm64", run } = {}) {
  const resolved = tools ?? resolveBuildTools();
  const args = gnArgsFor({ ndkPath: resolved.ndkPath, arch });
  const outDir = skiaOutDir(sourceRoot, arch);
  const exec = run ?? ((cmd, cmdArgs) => execFileSync(cmd, cmdArgs, { stdio: "inherit" }));
  exec(resolved.gnPath, ["gen", outDir, `--args=${args}`]);
  exec(resolved.ninjaPath, ["-C", outDir, ...REQUIRED_ARCHIVES.map((n) => `lib${n}.a`)]);
  return verifySkiaAndroidCache(sourceRoot, { arch });
}

// --only skia-android entry point for download-deps.mjs. Fails closed when
// the staged source tree is absent or its cache is incomplete.
export async function buildSkiaAndroidFromStagedSource({ sourceRoot, destDir } = {}) {
  const source = sourceRoot ?? join(packageRoot, ".skia-android-src");
  const dest = destDir ?? join(packageRoot, "third_party", "skia-android", "build");
  const tools = resolveBuildTools();
  try {
    verifySkiaAndroidCache(source);
    console.log(`skia-android cache hit at ${skiaOutDir(source)}`);
  } catch (error) {
    if (!String(error?.message ?? error).includes("TN_SKIA_ANDROID_CACHE_INCOMPLETE")) throw error;
    console.log("skia-android cache incomplete; rebuilding the bounded archive set");
    verifySourcePins(source);
    buildSkiaAndroid({ sourceRoot: source, tools });
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
  await buildSkiaAndroidFromStagedSource({ sourceRoot: source, destDir: dest });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}

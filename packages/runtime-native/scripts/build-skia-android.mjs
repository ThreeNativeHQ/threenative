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
  renameSync,
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
export const GN_INITIAL_TAG_OBJECT = "f0be552ab5313bb64a75c9365af22155d979949f";
export const GN_INITIAL_COMMIT = "95374957437b818e9addc26c83340b27a1b38202";
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
export const SOURCE_RECEIPT = ".threenative-skia-source.json";
export const SOURCE_GIT_TIMEOUT_MS = 120_000;
export const SOURCE_BOOTSTRAP_TIMEOUT_MS = 900_000;

const DEP_PATHS = Object.freeze({
  expat: ["skia", "third_party", "externals", "expat"],
  freetype: ["skia", "third_party", "externals", "freetype"],
  libpng: ["skia", "third_party", "externals", "libpng"],
  wuffs: ["skia", "third_party", "externals", "wuffs"],
  zlib: ["skia", "third_party", "externals", "zlib"],
});

export const SOURCE_REPOSITORIES = Object.freeze([
  { name: "skia", path: ["skia"], remote: "https://github.com/google/skia.git", commit: SKIA_COMMIT },
  { name: "gn", path: ["gn-src"], remote: "https://gn.googlesource.com/gn", commit: GN_COMMIT },
  {
    name: "expat",
    path: DEP_PATHS.expat,
    remote: "https://chromium.googlesource.com/external/github.com/libexpat/libexpat.git",
    commit: DEP_PINS.expat,
  },
  {
    name: "freetype",
    path: DEP_PATHS.freetype,
    remote: "https://chromium.googlesource.com/chromium/src/third_party/freetype2.git",
    commit: DEP_PINS.freetype,
  },
  {
    name: "libpng",
    path: DEP_PATHS.libpng,
    remote: "https://skia.googlesource.com/third_party/libpng.git",
    commit: DEP_PINS.libpng,
  },
  {
    name: "wuffs",
    path: DEP_PATHS.wuffs,
    remote: "https://skia.googlesource.com/external/github.com/google/wuffs-mirror-release-c.git",
    commit: DEP_PINS.wuffs,
  },
  {
    name: "zlib",
    path: DEP_PATHS.zlib,
    remote: "https://chromium.googlesource.com/chromium/src/third_party/zlib",
    commit: DEP_PINS.zlib,
  },
]);

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

function resolvePython(options = {}) {
  if (optionProvided(options, "pythonPath")) {
    if (isExecutableFile(options.pythonPath)) return resolve(options.pythonPath);
    throw new Error(`TN_PYTHON_INVALID: ${options.pythonPath}`);
  }
  const pathEntries = options.pathEntries ?? (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const python = findOnPath(process.platform === "win32" ? "python" : "python3", pathEntries) ?? findOnPath("python", pathEntries);
  if (python) return python;
  throw new Error("TN_PYTHON_MISSING: python3 not on PATH");
}

function resolveHostCxx(pathEntries) {
  const names = process.platform === "win32" ? ["cl"] : ["c++", "g++", "clang++"];
  const compiler = names.map((name) => findOnPath(name, pathEntries)).find(Boolean);
  if (compiler) return compiler;
  throw new Error("TN_HOST_CXX_MISSING: GN bootstrap requires a host C++ compiler");
}

// Validate NDK + Ninja, and GN when requested. Never falls back silently when an explicit path is invalid.
export function resolveBuildTools(options = {}) {
  const androidHome = options.androidHome ?? process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? null;
  const ndkPath = resolveNdk(options, androidHome);
  const pathEntries = options.pathEntries ?? (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const ninjaPath = resolveExecutable(options, "ninja", [join(packageRoot, ".runtime", "tools-venv", "bin"), ...pathEntries]);
  const hostCxxPath = resolveHostCxx(pathEntries);
  if (options.requireGn === false) return { ndkPath, ninjaPath, hostCxxPath };
  const gnPath = resolveExecutable(options, "gn", pathEntries);
  return { ndkPath, ninjaPath, gnPath, hostCxxPath };
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

function gitOutput(runGit, args) {
  return String(runGit(args, { encoding: "utf8", timeout: SOURCE_GIT_TIMEOUT_MS }) ?? "").trim();
}

function isGitRepository(runGit, repository) {
  try {
    return resolve(gitOutput(runGit, ["-C", repository, "rev-parse", "--show-toplevel"])) === resolve(repository);
  } catch {
    return false;
  }
}

function gitStatus(runGit, repository) {
  return gitOutput(runGit, ["-C", repository, "status", "--porcelain", "--untracked-files=all"]);
}

function gitRemote(runGit, repository) {
  try {
    return gitOutput(runGit, ["-C", repository, "remote", "get-url", "origin"]);
  } catch {
    return null;
  }
}

function gitHeadOrNull(runGit, repository) {
  try {
    return gitOutput(runGit, ["-C", repository, "rev-parse", "HEAD"]);
  } catch {
    return null;
  }
}

function initializeRepository(runGit, repository, source) {
  mkdirSync(repository, { recursive: true });
  runGit(["init", repository], { timeout: SOURCE_GIT_TIMEOUT_MS });
  runGit(["-C", repository, "remote", "add", "origin", source.remote], { timeout: SOURCE_GIT_TIMEOUT_MS });
}

function gitTryOutput(runGit, args) {
  try {
    return gitOutput(runGit, args);
  } catch {
    return null;
  }
}

function ensureGnHistory(runGit, repository) {
  let tagObject = gitTryOutput(runGit, ["-C", repository, "rev-parse", "refs/tags/initial-commit"]) ?? null;
  let tagCommit = gitTryOutput(runGit, ["-C", repository, "rev-parse", "refs/tags/initial-commit^{}"]) ?? null;
  if ((tagObject && tagObject !== GN_INITIAL_TAG_OBJECT) || (tagCommit && tagCommit !== GN_INITIAL_COMMIT)) {
    throw new Error(`TN_SKIA_ANDROID_GN_TAG: initial-commit resolves to ${tagCommit}, expected ${GN_INITIAL_COMMIT}`);
  }
  if (gitTryOutput(runGit, ["-C", repository, "describe", "HEAD", "--abbrev=12", "--match", "initial-commit"])?.startsWith("initial-commit-")) return;
  if (gitTryOutput(runGit, ["-C", repository, "rev-parse", "--is-shallow-repository"]) === "true") {
    runGit(["-C", repository, "fetch", "--no-tags", "--unshallow", "origin", GN_COMMIT], { timeout: SOURCE_GIT_TIMEOUT_MS });
  }
  if (!tagCommit) {
    runGit(["-C", repository, "fetch", "--no-tags", "origin", "refs/tags/initial-commit:refs/tags/initial-commit"], {
      timeout: SOURCE_GIT_TIMEOUT_MS,
    });
    tagObject = gitTryOutput(runGit, ["-C", repository, "rev-parse", "refs/tags/initial-commit"]) ?? null;
    tagCommit = gitTryOutput(runGit, ["-C", repository, "rev-parse", "refs/tags/initial-commit^{}"]) ?? null;
  }
  if (tagObject !== GN_INITIAL_TAG_OBJECT || tagCommit !== GN_INITIAL_COMMIT || !gitTryOutput(runGit, ["-C", repository, "describe", "HEAD", "--abbrev=12", "--match", "initial-commit"])?.startsWith("initial-commit-")) {
    throw new Error(`TN_SKIA_ANDROID_GN_TAG: ${repository} lacks the pinned initial-commit ancestry`);
  }
}

function fetchPinnedRepository(runGit, repository, source) {
  runGit(["-C", repository, "fetch", "--no-tags", ...(source.name === "gn" ? [] : ["--depth=1"]), "origin", source.commit], {
    timeout: SOURCE_GIT_TIMEOUT_MS,
  });
  runGit(["-C", repository, "checkout", "--detach", source.commit], { timeout: SOURCE_GIT_TIMEOUT_MS });
  if (source.name === "gn") ensureGnHistory(runGit, repository);
}

function ensurePinnedRepository(runGit, root, source, { repair } = {}) {
  const repository = join(root, ...source.path);
  if (!isDirectory(repository)) {
    if (!repair) throw new Error(`TN_SKIA_ANDROID_SOURCE_INCOMPLETE: missing ${source.name} at ${repository}`);
    initializeRepository(runGit, repository, source);
    fetchPinnedRepository(runGit, repository, source);
    return;
  }
  if (!isGitRepository(runGit, repository)) {
    throw new Error(`TN_SKIA_ANDROID_SOURCE_PARTIAL: ${repository} is not a Git repository; refusing to replace it`);
  }
  if (gitStatus(runGit, repository)) {
    throw new Error(`TN_SKIA_ANDROID_SOURCE_DIRTY: ${repository} has uncommitted changes; refusing to clean it`);
  }
  const remote = gitRemote(runGit, repository);
  if (remote && remote !== source.remote) {
    throw new Error(`TN_SKIA_ANDROID_SOURCE_REMOTE: ${source.name} origin is ${remote}, expected ${source.remote}`);
  }
  if (!remote) {
    if (!repair) throw new Error(`TN_SKIA_ANDROID_SOURCE_REMOTE: ${source.name} has no origin; refusing to mutate the existing source`);
    runGit(["-C", repository, "remote", "add", "origin", source.remote], { timeout: SOURCE_GIT_TIMEOUT_MS });
  }
  const head = gitHeadOrNull(runGit, repository);
  if (head === source.commit) {
    if (source.name === "gn") ensureGnHistory(runGit, repository);
    return;
  }
  if (head && head !== source.commit) {
    throw new Error(`TN_SKIA_ANDROID_SOURCE_HEAD: ${source.name} HEAD is ${head}, expected ${source.commit}`);
  }
  if (!repair) {
    throw new Error(`TN_SKIA_ANDROID_SOURCE_HEAD: ${source.name} HEAD is ${head ?? "missing"}, expected ${source.commit}`);
  }
  fetchPinnedRepository(runGit, repository, source);
}

function sourceReceipt(complete = true) {
  return {
    version: 1,
    complete,
    repositories: SOURCE_REPOSITORIES.map(({ name, path, remote, commit }) => ({ name, path, remote, commit })),
  };
}

function validateSourceReceipt(root) {
  const receiptPath = join(root, SOURCE_RECEIPT);
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  } catch (error) {
    throw new Error(`TN_SKIA_ANDROID_SOURCE_STAGING_INVALID: cannot parse ${receiptPath}`, { cause: error });
  }
  const expected = sourceReceipt();
  if (receipt?.version !== expected.version || typeof receipt.complete !== "boolean" || !Array.isArray(receipt.repositories) || receipt.repositories.length !== expected.repositories.length) {
    throw new Error(`TN_SKIA_ANDROID_SOURCE_STAGING_INVALID: ownership marker ${receiptPath} is not for this pinned source set`);
  }
  for (let index = 0; index < expected.repositories.length; index += 1) {
    const actual = receipt.repositories[index];
    const pinned = expected.repositories[index];
    if (actual?.name !== pinned.name || actual?.remote !== pinned.remote || actual?.commit !== pinned.commit || JSON.stringify(actual?.path) !== JSON.stringify(pinned.path)) {
      throw new Error(`TN_SKIA_ANDROID_SOURCE_STAGING_INVALID: ownership marker ${receiptPath} has a pin mismatch`);
    }
  }
}

function verifyPinnedSourceTree(runGit, root) {
  for (const repository of SOURCE_REPOSITORIES) ensurePinnedRepository(runGit, root, repository, { repair: false });
}

function bootstrapGn({ sourceRoot, gnOutDir, ninjaPath, pythonPath, jobs, runCommand }) {
  const gnSource = join(sourceRoot, "gn-src");
  const outDir = resolve(gnOutDir);
  const gnPath = join(outDir, process.platform === "win32" ? "gn.exe" : "gn");
  mkdirSync(outDir, { recursive: true });
  runCommand(pythonPath, ["build/gen.py", "--out-path", outDir], {
    cwd: gnSource,
    timeout: SOURCE_BOOTSTRAP_TIMEOUT_MS,
  });
  runCommand(ninjaPath, ["-C", outDir, "-j", String(jobs), "gn"], {
    cwd: gnSource,
    timeout: SOURCE_BOOTSTRAP_TIMEOUT_MS,
  });
  if (!isExecutableFile(gnPath)) {
    throw new Error(`TN_SKIA_ANDROID_GN_BOOTSTRAP: expected generated GN at ${gnPath}`);
  }
  return gnPath;
}

function provisionExistingSource({ source, gnOutDir, ninjaPath, pythonPath, jobs, runGit, runCommand }) {
  verifyPinnedSourceTree(runGit, source);
  return {
    sourceRoot: source,
    gnPath: bootstrapGn({ sourceRoot: source, gnOutDir, ninjaPath, pythonPath, jobs, runCommand }),
  };
}

// Provision exact source pins into an owned sibling staging root, then atomically rename it.
// Existing user trees are only inspected; they are never cleaned, reset, or replaced.
export function provisionSkiaAndroidSource({
  sourceRoot = join(packageRoot, ".runtime", "skia-android-source"),
  gnOutDir = join(packageRoot, ".runtime", "skia-android-gn", GN_COMMIT),
  ninjaPath,
  pythonPath,
  jobs = 2,
  pathEntries,
  runGit = (args, options) => execFileSync("git", args, { ...options, encoding: "utf8" }),
  runCommand = (command, args, options) => execFileSync(command, args, { stdio: "inherit", ...options }),
} = {}) {
  const source = resolve(sourceRoot);
  if (!Number.isInteger(jobs) || jobs < 1) throw new Error(`TN_SKIA_ANDROID_JOBS: expected a positive integer, received ${jobs}`);
  const resolvedNinja = ninjaPath ?? resolveBuildTools({ requireGn: false, pathEntries }).ninjaPath;
  if (!isExecutableFile(resolvedNinja)) throw new Error(`TN_NINJA_INVALID: ${resolvedNinja}`);
  const resolvedPython = pythonPath ?? resolvePython({ pathEntries });
  if (!isExecutableFile(resolvedPython)) throw new Error(`TN_PYTHON_INVALID: ${resolvedPython}`);
  resolveHostCxx(pathEntries ?? (process.env.PATH ?? "").split(delimiter).filter(Boolean));

  if (isDirectory(source)) {
    return provisionExistingSource({ source, gnOutDir, ninjaPath: resolvedNinja, pythonPath: resolvedPython, jobs, runGit, runCommand });
  }
  if (existsSync(source)) throw new Error(`TN_SKIA_ANDROID_SOURCE_PARTIAL: ${source} is not a directory; refusing to replace it`);

  const staging = `${source}.staging`;
  if (existsSync(staging) && !isDirectory(staging)) {
    throw new Error(`TN_SKIA_ANDROID_SOURCE_PARTIAL: ${staging} is not a directory; refusing to replace it`);
  }
  if (existsSync(staging)) validateSourceReceipt(staging);
  else {
    mkdirSync(staging, { recursive: true });
    writeFileSync(join(staging, SOURCE_RECEIPT), `${JSON.stringify(sourceReceipt(false), null, 2)}\n`);
  }
  for (const repository of SOURCE_REPOSITORIES) ensurePinnedRepository(runGit, staging, repository, { repair: true });
  const gnPath = bootstrapGn({ sourceRoot: staging, gnOutDir, ninjaPath: resolvedNinja, pythonPath: resolvedPython, jobs, runCommand });
  writeFileSync(join(staging, SOURCE_RECEIPT), `${JSON.stringify(sourceReceipt(), null, 2)}\n`);
  if (existsSync(source)) throw new Error(`TN_SKIA_ANDROID_SOURCE_RACE: source appeared while provisioning; staging preserved at ${staging}`);
  renameSync(staging, source);
  return { sourceRoot: source, gnPath };
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

// --only skia-android entry point for download-deps.mjs. Missing source is provisioned from exact pins.
export async function buildSkiaAndroidFromStagedSource({
  sourceRoot,
  destDir,
  jobs = 2,
  tools,
  gnOutDir,
  pythonPath,
  pathEntries,
  runGit,
  runCommand,
  buildRun,
} = {}) {
  const source = resolve(sourceRoot ?? join(packageRoot, ".runtime", "skia-android-source"));
  const dest = resolve(destDir ?? join(packageRoot, "third_party", "skia-android", "build"));
  const sourceGit = runGit ?? ((args, options) => execFileSync("git", args, { ...options, encoding: "utf8" }));
  try {
    verifySkiaAndroidCache(source);
    verifyPinnedSourceTree(sourceGit, source);
    console.log(`skia-android cache hit at ${skiaOutDir(source)}`);
  } catch (error) {
    if (!String(error?.message ?? error).includes("TN_SKIA_ANDROID_CACHE_INCOMPLETE")) throw error;
    const resolvedTools = tools ?? resolveBuildTools({ requireGn: false, pathEntries });
    const provisioned = provisionSkiaAndroidSource({
      sourceRoot: source,
      gnOutDir,
      ninjaPath: resolvedTools.ninjaPath,
      pythonPath,
      pathEntries,
      ...(runGit ? { runGit } : {}),
      ...(runCommand ? { runCommand } : {}),
      jobs,
    });
    console.log("skia-android cache incomplete; rebuilding the bounded archive set");
    buildSkiaAndroid({ sourceRoot: source, tools: { ...resolvedTools, gnPath: provisioned.gnPath }, jobs, run: buildRun });
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
  const source = valueAfter(args, "--source") ?? join(packageRoot, ".runtime", "skia-android-source");
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

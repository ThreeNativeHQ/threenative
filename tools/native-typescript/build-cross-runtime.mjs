#!/usr/bin/env node
// Build Perry's cross runtime from the source tree its compiler was built from (PRD-507).
//
// Perry v0.5.1520 stamps its Linux compiler `src:<sha256 of the tag's contract sources>` (a build
// from an exported tree with no .git) and its Android runtime `git:<tag commit>`. Perry refuses to
// link a pair whose stamps differ, so the shipped pair cannot link. A runtime built from the same
// tag, exported without .git, takes the `src:` stamp and matches. compiler.lock.json `crossBuilds`
// pins that stamp; nothing here weakens Perry's own check, which still runs at every link.
//
//   node build-cross-runtime.mjs --target <triple> [--jobs <n>] [--work <dir>] [--out <dir>]
//       clone the pinned tag, export it without .git, cargo-build the runtime, stdlib and UI
//       archives with the NDK, and stage them with a Perry-style manifest.json in <out>
//   node build-cross-runtime.mjs --target <triple> --install <dir>
//       check a staged <dir> (a build made on another machine) against the pin and install it in
//       the toolchain cache, where provisionCross finds it
//
// The Rust toolchain is the one rust-toolchain.toml in the exported tree names, and it must have the
// target installed (`rustup target add <triple> --toolchain <channel>`).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findTarget, resolveNdk } from "./android.mjs";
import { builtCrossDir, installBuiltCross, loadLock, readRuntimeStamp } from "./provision.mjs";

const PACKAGES = [
  ["perry-runtime", "perry-runtime-static"],
  ["perry-stdlib", "perry-stdlib-static"],
  ["perry-ui-android"],
];
const ARCHIVES = ["libperry_runtime.a", "libperry_stdlib.a", "libperry_ui_android.a"];

function named(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    throw named(
      "TN_NATIVE_TS_CROSS_BUILD",
      `${command} ${args.slice(0, 3).join(" ")} exited ${result.status ?? result.signal}`,
    );
  }
}

/** The pinned tag, exported with no .git so the runtime takes the same `src:` stamp as the compiler. */
export function exportSource(lock, work, remote = `https://github.com/${lock.repository}`) {
  const clone = path.join(work, "clone");
  const exported = path.join(work, "src");
  if (!fs.existsSync(path.join(clone, ".git"))) {
    run("git", ["clone", "--depth", "1", "--branch", lock.tag, remote, clone]);
  }
  const head = spawnSync("git", ["-C", clone, "rev-parse", "HEAD"], { encoding: "utf8" });
  if (head.stdout.trim() !== lock.tagRefSha) {
    throw named(
      "TN_NATIVE_TS_CROSS_BUILD",
      `tag ${lock.tag} is ${head.stdout.trim()}, the lock pins ${lock.tagRefSha}`,
    );
  }
  fs.rmSync(exported, { recursive: true, force: true });
  fs.mkdirSync(exported, { recursive: true });
  const archive = spawnSync("git", ["-C", clone, "archive", "HEAD"], {
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (archive.status !== 0) throw named("TN_NATIVE_TS_CROSS_BUILD", "git archive failed");
  const tar = spawnSync("tar", ["-x", "-C", exported], { input: archive.stdout });
  if (tar.status !== 0) throw named("TN_NATIVE_TS_CROSS_BUILD", "tar -x of the export failed");
  return exported;
}

/**
 * The Rust toolchain the exported tree pins, which must name a date or a release: a floating
 * channel would make the same tag build different runtimes on different days.
 */
export function assertDatePinnedToolchain(source) {
  const file = path.join(source, "rust-toolchain.toml");
  const channel = /^\s*channel\s*=\s*"([^"]+)"/mu.exec(
    fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "",
  )?.[1];
  if (
    channel === undefined ||
    !/^(?:(?:nightly|beta|stable)-\d{4}-\d{2}-\d{2}|\d+\.\d+(?:\.\d+)?)$/u.test(channel)
  ) {
    throw named(
      "TN_NATIVE_TS_CROSS_BUILD",
      `rust-toolchain.toml pins ${channel === undefined ? "no channel" : `the floating channel ${channel}`}; a date or release is required`,
    );
  }
  return channel;
}

/** A built runtime is accepted only when it carries the stamp the lock pins, which is the compiler's. */
export function assertBuiltStamp(staged, build) {
  const stamp = readRuntimeStamp(path.join(staged, "libperry_runtime.a"));
  if (stamp?.build !== build.buildId) {
    throw named(
      "TN_NATIVE_TS_CROSS_BUILD",
      `the built runtime is stamped ${stamp?.build ?? "unstamped"}, the lock pins ${build.buildId}`,
    );
  }
  return stamp;
}

/** The sysroot and clang builtin headers (stdarg.h and friends) bindgen needs to parse a C header for the NDK. */
function bindgenArgs(ndk) {
  const clangDir = path.join(ndk.bin, "lib", "clang");
  const version = fs.existsSync(clangDir) ? fs.readdirSync(clangDir)[0] : undefined;
  return [
    `--sysroot=${path.join(ndk.bin, "sysroot")}`,
    ...(version === undefined ? [] : [`-isystem${path.join(clangDir, version, "include")}`]),
  ].join(" ");
}

/** Cargo's cross environment for an NDK clang, the same variables Perry's release workflow sets. */
export function crossEnv(triple, ndk, apiLevel, env = process.env) {
  const bin = path.join(ndk.bin, "bin");
  const under = triple.replaceAll("-", "_");
  const clang = path.join(bin, `${triple}${apiLevel}-clang`);
  const entries = [
    ["ANDROID_NDK_HOME", ndk.dir],
    ["ANDROID_API_LEVEL", String(apiLevel)],
    [`CC_${under}`, clang],
    [`CXX_${under}`, `${clang}++`],
    [`AR_${under}`, path.join(bin, "llvm-ar")],
    [`CARGO_TARGET_${under.toUpperCase()}_LINKER`, clang],
    // libsqlite3-sys runs bindgen at build time: the NDK ships the libclang it needs and its sysroot.
    ["LIBCLANG_PATH", path.join(ndk.bin, "lib")],
    [`BINDGEN_EXTRA_CLANG_ARGS_${under}`, bindgenArgs(ndk)],
  ];
  return Object.assign({ ...env }, Object.fromEntries(entries));
}

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** Copies the built archives next to a Perry-style manifest.json, which provisionCross checks. */
export function stage(releaseDir, outDir, triple, version) {
  fs.mkdirSync(outDir, { recursive: true });
  const files = ARCHIVES.map((name) => {
    const target = path.join(outDir, name);
    fs.copyFileSync(path.join(releaseDir, name), target);
    return { path: name, sha256: sha256(target), size: fs.statSync(target).size };
  });
  // Perry's manifest keys are snake_case and must keep that spelling.
  const manifest = Object.fromEntries([
    ["perry_version", version],
    ["target_triple", triple],
    ["files", files],
  ]);
  fs.writeFileSync(
    path.join(outDir, "manifest.json"),
    `${JSON.stringify(manifest, undefined, 2)}\n`,
  );
  return manifest;
}

export function buildCrossRuntime(triple, { lock = loadLock(), jobs = 4, work, out } = {}) {
  const build = lock.crossBuilds?.[triple];
  if (build === undefined) {
    throw named("TN_NATIVE_TS_CROSS_BUILD", `compiler.lock.json pins no crossBuilds for ${triple}`);
  }
  const found = findTarget(triple);
  if (found === undefined) throw named("TN_NATIVE_TS_TARGET", `no target file for ${triple}`);
  const ndk = resolveNdk(found.target);
  const workDir = work ?? path.join(builtCrossDir(lock, triple), "work");
  fs.mkdirSync(workDir, { recursive: true });
  const source = exportSource(lock, workDir);
  const env = crossEnv(triple, ndk, found.target.apiLevel);
  // rust-toolchain.toml in the exported tree picks the channel, and rustup installs it on first use.
  assertDatePinnedToolchain(source);
  for (const packages of PACKAGES) {
    run(
      "cargo",
      [
        "build",
        // Cargo.lock decides every dependency: a lock that needs updating fails the build.
        "--locked",
        "-j",
        String(jobs),
        "--profile",
        "dist",
        "--target",
        triple,
        ...packages.flatMap((name) => ["-p", name]),
      ],
      { cwd: source, env },
    );
  }
  const staged = out ?? path.join(workDir, "staged");
  const manifest = stage(
    path.join(source, "target", triple, "dist"),
    staged,
    triple,
    build.version,
  );
  const stamp = assertBuiltStamp(staged, build);
  return { staged, manifest, stamp };
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const triple = option("--target");
  if (triple === undefined) throw named("TN_NATIVE_TS_USAGE", "pass --target <triple>");
  const install = option("--install");
  if (install !== undefined) {
    const dir = installBuiltCross(triple, path.resolve(install), {});
    process.stdout.write(`${dir}\n`);
    return;
  }
  const result = buildCrossRuntime(triple, {
    jobs: Number(option("--jobs") ?? Math.max(1, Math.floor(os.cpus().length / 4))),
    work: option("--work") ? path.resolve(option("--work")) : undefined,
    out: option("--out") ? path.resolve(option("--out")) : undefined,
  });
  process.stdout.write(`${result.staged}\n${result.stamp.build}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

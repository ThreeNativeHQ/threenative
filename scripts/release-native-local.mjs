#!/usr/bin/env node
/**
 * Stage the runtime payload this host can actually build into a canonical release directory.
 *
 * The CI release matrix builds every platform on its own runner and lets `generateReleaseManifest`
 * require the full cohort. A workstation cannot do that, so a local release would otherwise refuse
 * the whole matrix it cannot produce. This assembler names only the keys it staged and hands them to
 * the same lock generator (`keys`), which writes a scoped lock that advertises exactly those assets.
 *
 * `PREBUILT_ASSET_NAMES` stays the single owner of file names; this file owns only where the local
 * build puts the bytes behind each key. It is pure Node — no compiler, no NDK, no new dependency —
 * and never touches GitHub. Publishing is `scripts/release-native-local.ts`.
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PREBUILT_ASSET_NAMES,
  RELEASE_REPOSITORY,
  generateReleaseManifest,
  platformKey,
  releaseTag,
  toolsKey,
} from "../packages/runtime-native/scripts/install-prebuilt.mjs";

/** Re-exported so the CLI checks one repository with the lock it publishes. */
export { RELEASE_REPOSITORY };

export const DEFAULT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const HOST_PRESETS = Object.freeze({ darwin: "tn-macos", linux: "tn-linux", win32: "tn-windows" });

/**
 * The host desktop runtime and the `mystral-tools` helper beside it.
 *
 * `src/cli/tool_dispatch.cpp` dispatches a desktop build to the helper, so the helper is a release
 * asset of its own; a lock that carries the runtime without it installs a package that dies 127.
 */
export function hostPayloadPlan({
  repo = DEFAULT_REPO,
  platform = process.platform,
  arch = process.arch,
} = {}) {
  const key = platformKey(platform, arch);
  const preset = HOST_PRESETS[platform];
  if (preset === undefined) throw new Error(`No local build preset exists for host '${platform}'.`);
  const build = join(repo, "packages", "runtime-native", "build", preset);
  const suffix = platform === "win32" ? ".exe" : "";
  return [
    { key, source: join(build, `mystral${suffix}`) },
    { key: toolsKey(key), source: join(build, `mystral-tools${suffix}`) },
  ];
}

function findSdl3Aar(repo) {
  const directory = join(repo, "packages", "runtime-native", "third_party", "sdl3-android");
  if (!existsSync(directory)) return undefined;
  const aar = readdirSync(directory).find((name) => /^SDL3-.*\.aar$/u.test(name));
  return aar === undefined ? undefined : join(directory, aar);
}

/**
 * The Android payloads, when this checkout has staged an NDK build.
 *
 * The default engine is V8, and the build intermediates hold one engine at a time, so this stages
 * the V8-qualified runtime keys and not the unqualified QuickJS ones: a lock must never name a byte
 * this host did not produce. The CI lane keeps staging both engines from two builds.
 */
export function androidPayloadPlan({ repo = DEFAULT_REPO } = {}) {
  const runtime = join(repo, "packages", "runtime-native");
  const stripped = join(
    runtime,
    "android",
    "app",
    "build",
    "intermediates",
    "stripped_native_libs",
    "release",
    "out",
    "lib",
  );
  const snapshots = join(
    runtime,
    "android",
    "app",
    "build",
    "generated",
    "threenative",
    "assets",
    "v8",
  );
  const aar = findSdl3Aar(repo);
  return [
    {
      key: "android-arm64-v8a-runtime-v8",
      source: join(stripped, "arm64-v8a", "libmystral-runtime.so"),
    },
    { key: "android-arm64-v8a-v8", source: join(stripped, "arm64-v8a", "libv8android.so") },
    { key: "android-arm64-v8a-libcxx", source: join(stripped, "arm64-v8a", "libc++_shared.so") },
    {
      key: "android-arm64-v8a-v8-snapshot",
      source: join(snapshots, "arm64-v8a", "snapshot_blob.bin"),
    },
    { key: "android-arm64-v8a-sdl3", source: join(stripped, "arm64-v8a", "libSDL3.so") },
    { key: "android-x86_64-runtime-v8", source: join(stripped, "x86_64", "libmystral-runtime.so") },
    { key: "android-x86_64-v8", source: join(stripped, "x86_64", "libv8android.so") },
    { key: "android-x86_64-libcxx", source: join(stripped, "x86_64", "libc++_shared.so") },
    { key: "android-x86_64-v8-snapshot", source: join(snapshots, "x86_64", "snapshot_blob.bin") },
    { key: "android-x86_64-sdl3", source: join(stripped, "x86_64", "libSDL3.so") },
    ...(aar === undefined ? [] : [{ key: "android-sdl3-aar", source: aar }]),
  ];
}

function androidPayloadIsStaged(plan) {
  return plan.length > 0 && plan.every((entry) => existsSync(entry.source));
}

/** The host payload, plus Android when its whole staged set is present. */
export function defaultPayloadPlan(options = {}) {
  const host = hostPayloadPlan(options);
  const android = androidPayloadPlan(options);
  return androidPayloadIsStaged(android) ? [...host, ...android] : host;
}

function knownSources(options) {
  return new Map(
    [...hostPayloadPlan(options), ...androidPayloadPlan(options)].map((entry) => [
      entry.key,
      entry.source,
    ]),
  );
}

/** Stage only the named keys, in the caller's order. */
export function payloadPlanForKeys(keys, options = {}) {
  if (!Array.isArray(keys) || keys.length === 0)
    throw new Error("Release keys must be a non-empty array.");
  const sources = knownSources(options);
  return keys.map((key) => {
    if (!Object.hasOwn(PREBUILT_ASSET_NAMES, key))
      throw new Error(`Unknown prebuilt release key '${key}'.`);
    return { key, source: sources.get(key) };
  });
}

function gitHead(repo) {
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  if (!/^[a-f0-9]{40}$/u.test(sha))
    throw new Error(`Could not resolve a full source SHA in ${repo}.`);
  return sha;
}

/**
 * Copy the planned binaries into `directory` under their canonical names and write the scoped lock.
 *
 * Everything is checked before anything is copied, and the directory is rebuilt from empty, so a
 * missing build input fails naming its path and leaves no lock advertising bytes that are not there.
 */
export function stageLocalPayload(options = {}) {
  const repo = options.repo ?? DEFAULT_REPO;
  const directory = resolve(options.directory ?? join(repo, "release-native"));
  const sourceSha = options.sourceSha ?? gitHead(repo);
  const repository = options.repository ?? RELEASE_REPOSITORY;
  const plan =
    options.plan ??
    (options.keys === undefined
      ? defaultPayloadPlan({ ...options, repo })
      : payloadPlanForKeys(options.keys, { ...options, repo }));
  const missing = plan.filter((entry) => entry.source === undefined || !existsSync(entry.source));
  if (missing.length > 0) {
    const detail = missing
      .map((entry) => `${entry.key} <- ${entry.source ?? "(no known local build path)"}`)
      .join(", ");
    throw new Error(
      `TN_RELEASE_NATIVE_SOURCE_MISSING: no locally built binary for ${detail}. Nothing was staged.`,
    );
  }
  rmSync(directory, { force: true, recursive: true });
  mkdirSync(directory, { recursive: true });
  for (const entry of plan)
    copyFileSync(entry.source, join(directory, PREBUILT_ASSET_NAMES[entry.key]));
  const keys = plan.map((entry) => entry.key);
  const tag = options.tag ?? releaseTag();
  const manifest = generateReleaseManifest(directory, { repository, tag, sourceSha, keys });
  const manifestPath = join(directory, "prebuilt-lock.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { directory, keys, manifest, manifestPath, repository, tag };
}

#!/usr/bin/env node
// Provision the pinned Perry toolchain (decision 11).
//
// Downloads the per-host archive named in compiler.lock.json into a cache
// outside the repository, verifies its SHA-256 before extracting, and prints
// the compiler binary path. A cached, verified toolchain is a cache hit and
// makes no network call. A checksum mismatch fails closed with the code
// TN_NATIVE_TS_CHECKSUM.
//
// `opts.patches` is the fork ledger's patch set (patches.mjs). Each patch is applied inside the
// extracted tree and the tree's cache key carries the patch set, so a patched toolchain is never
// served to a run that asked for the toolchain exactly as upstream ships it. The unpatched cache
// holds the only downloaded archive; a patched tree extracts from it without a second download.
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { UPSTREAM_KEY, applyPatches, patchKey } from "./patches.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CHECKSUM_CODE = "TN_NATIVE_TS_CHECKSUM";
/** Proof of a complete extraction, in the cache beside `toolchain`, holding the archive sha256. */
const MARKER_NAME = ".verified";
/** Perry's cross runtime archives hold no compiler binary, so they get their own extraction root. */
const CROSS_DIR_NAME = "cross";
/** Proof that the tree in this cache carries the patch set its directory name claims. */
const PATCH_MARKER_NAME = ".patches";

export function loadLock(lockFile = path.join(HERE, "compiler.lock.json")) {
  return JSON.parse(fs.readFileSync(lockFile, "utf8"));
}

export function resolveHost(lock, host = process.env.TN_NATIVE_TS_HOST) {
  if (host) return host;
  const key = `${process.platform}-${process.arch}`;
  const preferred = lock.hostPreference?.[key];
  if (!preferred?.length) {
    throw named(
      "TN_NATIVE_TS_HOST",
      `no pinned toolchain for ${key}; set TN_NATIVE_TS_HOST to one of ${Object.keys(lock.artifacts).join(", ")}`,
    );
  }
  return preferred[0];
}

export function defaultCacheDir(lock, env = process.env, variant = UPSTREAM_KEY) {
  const base =
    env.TN_NATIVE_TS_CACHE || path.join(os.homedir(), ".cache", "threenative", "native-typescript");
  // The unpatched cache keeps the plain tag path it has always had, so an existing verified tree
  // stays valid; a patched set gets its own sibling directory.
  return variant === UPSTREAM_KEY
    ? path.join(base, lock.tag)
    : path.join(base, `${lock.tag}-${variant}`);
}

export async function provision(opts = {}) {
  const lock = opts.lock ?? loadLock(opts.lockFile);
  const host = opts.host ?? resolveHost(lock);
  const artifact = lock.artifacts?.[host];
  if (!artifact) {
    throw named("TN_NATIVE_TS_HOST", `no pinned toolchain for host ${host}`);
  }
  if (typeof artifact.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(artifact.sha256)) {
    throw named(CHECKSUM_CODE, `the pinned sha256 for ${host} is not 64 lowercase hex`);
  }
  const key = patchKey(opts.patches ?? []);
  const cacheDir = opts.cacheDir ?? defaultCacheDir(lock, opts.env, key);
  const toolchainDir = path.join(cacheDir, "toolchain");
  const archiveName = path.basename(new URL(artifact.url).pathname);
  // A patched tree extracts from the unpatched cache's archive, so a patch costs no second download.
  const archivePath = path.join(
    key === UPSTREAM_KEY ? cacheDir : defaultCacheDir(lock, opts.env),
    archiveName,
  );
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const log = opts.log ?? ((m) => process.stderr.write(`${m}\n`));

  await fsp.mkdir(cacheDir, { recursive: true });

  const archiveOk = await fileMatches(archivePath, artifact);
  const extractedOk =
    archiveOk &&
    (await markerMatches(cacheDir, artifact)) &&
    (await patchMarkerMatches(cacheDir, key));
  const binary = () => (extractedOk ? findBinary(toolchainDir, lock.binaryCandidates) : undefined);

  if (opts.checkOnly) {
    const found = binary();
    if (!found) {
      throw named(
        "TN_NATIVE_TS_CHECK",
        `cached toolchain for ${lock.tag} is missing or not verified`,
      );
    }
    log(`ok: ${found}`);
    return result({
      lock,
      host,
      artifact,
      cacheDir,
      toolchainDir,
      binaryPath: found,
      patchKey: key,
      cacheHit: true,
    });
  }

  if (extractedOk) {
    const found = binary();
    if (found) {
      log("cache hit");
      return result({
        lock,
        host,
        artifact,
        cacheDir,
        toolchainDir,
        binaryPath: found,
        cacheHit: true,
      });
    }
  }

  if (!archiveOk) {
    if (fs.existsSync(archivePath)) {
      // A present archive that does not match its pin is a corrupted cache, never a download
      // trigger: fail closed so a bad mirror cannot quietly replace a trusted artifact.
      await verifyOrThrow(archivePath, artifact);
    } else {
      if (typeof fetchImpl !== "function") {
        throw named("TN_NATIVE_TS_FETCH", `no fetch available to download ${artifact.url}`);
      }
      log(`downloading ${artifact.url}`);
      await downloadVerified(fetchImpl, artifact, archivePath);
    }
  }

  log("extracting");
  // The markers vouch for the tree, so they go before the tree is touched: a run killed while the
  // old tree is half-deleted must not find a marker that still matches.
  await fsp.rm(path.join(cacheDir, MARKER_NAME), { force: true });
  await fsp.rm(path.join(cacheDir, PATCH_MARKER_NAME), { force: true });
  const binaryPath = await extractAtomically(archivePath, toolchainDir, lock.binaryCandidates);
  applyPatches(toolchainDir, opts.patches ?? []);
  await writeMarker(cacheDir, artifact);
  await writeMarkerFile(path.join(cacheDir, PATCH_MARKER_NAME), key);
  return result({
    lock,
    host,
    artifact,
    cacheDir,
    toolchainDir,
    binaryPath,
    patchKey: key,
    cacheHit: false,
  });
}

/**
 * Extracts the archive into a sibling temp directory and renames it over the cache only once the
 * toolchain is complete, so a killed run leaves no half-tree that a later run trusts.
 */
async function extractAtomically(archivePath, toolchainDir, candidates) {
  const staging = `${toolchainDir}.${process.pid}.${randomUUID()}.tmp`;
  await fsp.rm(staging, { recursive: true, force: true });
  await fsp.mkdir(staging, { recursive: true });
  const tar = spawnSync("tar", ["-xzf", archivePath, "-C", staging], { stdio: "inherit" });
  if (tar.status !== 0) {
    await fsp.rm(staging, { recursive: true, force: true });
    throw named("TN_NATIVE_TS_EXTRACT", `tar exited ${tar.status} for ${archivePath}`);
  }
  if (!findBinary(staging, candidates)) {
    await fsp.rm(staging, { recursive: true, force: true });
    throw named(
      "TN_NATIVE_TS_BINARY",
      `no compiler binary (${candidates.join(", ")}) in the extracted toolchain`,
    );
  }
  await fsp.rm(toolchainDir, { recursive: true, force: true });
  await fsp.rename(staging, toolchainDir);
  const found = findBinary(toolchainDir, candidates);
  if (!found) {
    throw named(
      "TN_NATIVE_TS_BINARY",
      `no compiler binary (${candidates.join(", ")}) in the extracted toolchain`,
    );
  }
  return found;
}

async function markerMatches(cacheDir, artifact) {
  return (await readMarkerFile(path.join(cacheDir, MARKER_NAME))) === artifact.sha256;
}

/** A patched tree must carry the patch set its cache was keyed on, so an unpatched run cannot reuse it. */
async function patchMarkerMatches(cacheDir, key) {
  return (
    key === UPSTREAM_KEY || (await readMarkerFile(path.join(cacheDir, PATCH_MARKER_NAME))) === key
  );
}

async function readMarkerFile(file) {
  try {
    return (await fsp.readFile(file, "utf8")).trim();
  } catch {
    return undefined;
  }
}

async function writeMarker(cacheDir, artifact) {
  await writeMarkerFile(path.join(cacheDir, MARKER_NAME), artifact.sha256);
}

async function writeMarkerFile(file, value) {
  await fsp.writeFile(file, `${value}\n`, "utf8");
}

function result(fields) {
  return fields;
}

async function download(fetchImpl, url, dest) {
  const res = await fetchImpl(url, { redirect: "follow" });
  if (!res.ok) {
    throw named("TN_NATIVE_TS_FETCH", `GET ${url} returned ${res.status}`);
  }
  if (res.body && typeof res.body.getReader === "function") {
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
    return;
  }
  await fsp.writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

/** Streams to `<archive>.part` and publishes it only after the sha256 matches; a bad part dies. */
async function downloadVerified(fetchImpl, artifact, archivePath) {
  const part = `${archivePath}.part`;
  await fsp.rm(part, { force: true });
  await download(fetchImpl, artifact.url, part);
  try {
    await verifyOrThrow(part, artifact);
  } catch (error) {
    await fsp.rm(part, { force: true });
    throw error;
  }
  await fsp.rename(part, archivePath);
}

/** The same rule for a caller that pins its own archive: fetch it, prove it, then publish it. */
export function verifiedFetch(url, sha256, archivePath, opts = {}) {
  return downloadVerified(opts.fetchImpl ?? globalThis.fetch, { url, sha256 }, archivePath);
}

/**
 * Perry's cross runtime archive for `triple`: the runtime, stdlib and UI archives a cross `--target`
 * links, fetched and verified exactly like the host toolchain and extracted under its own cache
 * root. The returned directory is what `PERRY_RUNTIME_DIR` must point at, and its `manifest.json`
 * (Perry's own, naming the triple and each archive's sha256) is checked against the pin, so a
 * mirror serving another target's archives fails closed instead of linking them.
 */
export async function provisionCross(triple, opts = {}) {
  const lock = opts.lock ?? loadLock(opts.lockFile);
  // A triple whose shipped runtime cannot link with the shipped compiler is built from source
  // (build-cross-runtime.mjs); the release archive is not used for it.
  if (lock.crossBuilds?.[triple] !== undefined)
    return provisionBuiltCross(triple, { ...opts, lock });
  const artifact = lock.crossArtifacts?.[triple];
  if (!artifact) {
    throw named("TN_NATIVE_TS_HOST", `no pinned Perry cross runtime for ${triple}`);
  }
  if (typeof artifact.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(artifact.sha256)) {
    throw named(CHECKSUM_CODE, `the pinned sha256 for ${triple} is not 64 lowercase hex`);
  }
  const base =
    opts.env?.TN_NATIVE_TS_CACHE ??
    process.env.TN_NATIVE_TS_CACHE ??
    path.join(os.homedir(), ".cache", "threenative", "native-typescript");
  const cacheDir = opts.cacheDir ?? path.join(base, lock.tag, CROSS_DIR_NAME, triple);
  const archiveName = path.basename(new URL(artifact.url).pathname);
  const archivePath = path.join(cacheDir, archiveName);
  const dir = path.join(cacheDir, "toolchain");
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const log = opts.log ?? ((m) => process.stderr.write(`${m}\n`));

  await fsp.mkdir(cacheDir, { recursive: true });
  const marker = path.join(cacheDir, MARKER_NAME);
  if (
    (await fileMatches(archivePath, artifact)) &&
    (await readMarkerFile(marker)) === artifact.sha256 &&
    (await crossManifestOk(dir, triple))
  ) {
    log("cache hit");
    return { triple, artifact, cacheDir, dir, manifestPath: path.join(dir, "manifest.json") };
  }
  if (!fs.existsSync(archivePath)) {
    if (typeof fetchImpl !== "function") {
      throw named("TN_NATIVE_TS_FETCH", `no fetch available to download ${artifact.url}`);
    }
    log(`downloading ${artifact.url}`);
    await downloadVerified(fetchImpl, artifact, archivePath);
  } else {
    await verifyOrThrow(archivePath, artifact);
  }
  log("extracting");
  const staging = `${dir}.${process.pid}.${randomUUID()}.tmp`;
  await fsp.rm(staging, { recursive: true, force: true });
  await fsp.mkdir(staging, { recursive: true });
  const tar = spawnSync("tar", ["-xzf", archivePath, "-C", staging], { stdio: "inherit" });
  if (tar.status !== 0) {
    await fsp.rm(staging, { recursive: true, force: true });
    throw named("TN_NATIVE_TS_EXTRACT", `tar exited ${tar.status} for ${archivePath}`);
  }
  const manifestPath = path.join(staging, "manifest.json");
  const why = crossManifestProblem(staging, triple);
  if (why !== undefined) {
    await fsp.rm(staging, { recursive: true, force: true });
    throw named(CHECKSUM_CODE, `${archiveName}: ${why}`);
  }
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.rename(staging, dir);
  await writeMarker(cacheDir, artifact);
  return { triple, artifact, cacheDir, dir, manifestPath };
}

/** Where a cross runtime built from source lives: `toolchain/` holds what Perry links, `work/` the build. */
export function builtCrossDir(lock, triple, env = process.env) {
  const base =
    env.TN_NATIVE_TS_CACHE || path.join(os.homedir(), ".cache", "threenative", "native-typescript");
  return path.join(base, lock.tag, "cross-built", triple);
}

/**
 * The build stamp Perry embeds in a runtime archive (`PERRY_RUNTIME_BUILD_STAMP_V1|version=..|build=..`),
 * read the way Perry reads it. Undefined for an archive with no stamp.
 */
export function readRuntimeStamp(archive) {
  const bytes = fs.readFileSync(archive);
  const prefix = Buffer.from("PERRY_RUNTIME_BUILD_STAMP_V1|");
  const start = bytes.indexOf(prefix);
  if (start < 0) return undefined;
  const end = bytes.indexOf(0, start);
  const fields = bytes
    .subarray(start, end < 0 ? start + 512 : end)
    .toString("utf8")
    .split("|");
  const version = fields.find((field) => field.startsWith("version="))?.slice("version=".length);
  const build = fields.find((field) => field.startsWith("build="))?.slice("build=".length);
  return version && build ? { version, build } : undefined;
}

/** A built tree is usable only when its manifest holds, and its runtime carries the pinned stamp. */
function builtCrossProblem(dir, triple, build) {
  const manifest = crossManifestProblem(dir, triple);
  if (manifest !== undefined) return manifest;
  let stamp;
  try {
    stamp = readRuntimeStamp(path.join(dir, "libperry_runtime.a"));
  } catch (error) {
    return `cannot read libperry_runtime.a: ${error.message}`;
  }
  if (stamp?.build !== build.buildId) {
    return `libperry_runtime.a is stamped ${stamp?.build ?? "unstamped"}, compiler.lock.json pins ${build.buildId}`;
  }
  return undefined;
}

/** The cross runtime built from the pinned source: found in the cache, or a named instruction to build it. */
export function provisionBuiltCross(triple, opts = {}) {
  const lock = opts.lock ?? loadLock(opts.lockFile);
  const build = lock.crossBuilds[triple];
  const cacheDir = opts.cacheDir ?? builtCrossDir(lock, triple, opts.env);
  const dir = path.join(cacheDir, "toolchain");
  const problem = fs.existsSync(dir)
    ? builtCrossProblem(dir, triple, build)
    : "no built runtime in the cache";
  if (problem !== undefined) {
    throw named(
      "TN_NATIVE_TS_CROSS_BUILD",
      `${triple}: ${problem}. Build it: node tools/native-typescript/build-cross-runtime.mjs --target ${triple}`,
    );
  }
  return { triple, artifact: build, cacheDir, dir, manifestPath: path.join(dir, "manifest.json") };
}

/** Checks a runtime built elsewhere (a staged directory) against the pin and installs it in the cache. */
export function installBuiltCross(triple, staged, opts = {}) {
  const lock = opts.lock ?? loadLock(opts.lockFile);
  const build = lock.crossBuilds?.[triple];
  if (build === undefined) throw named("TN_NATIVE_TS_HOST", `no crossBuilds pin for ${triple}`);
  const problem = builtCrossProblem(staged, triple, build);
  if (problem !== undefined) throw named("TN_NATIVE_TS_CROSS_BUILD", `${staged}: ${problem}`);
  const cacheDir = opts.cacheDir ?? builtCrossDir(lock, triple, opts.env);
  const dir = path.join(cacheDir, "toolchain");
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(staged, dir, { recursive: true });
  return dir;
}

/** Perry's own cross manifest: it names the triple and pins every archive inside it. */
function readCrossManifest(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  } catch {
    return undefined;
  }
}

function crossManifestProblem(dir, triple) {
  const manifest = readCrossManifest(dir);
  if (manifest === undefined) return "the archive holds no manifest.json";
  if (manifest.target_triple !== triple) {
    return `its manifest names target_triple ${manifest.target_triple}, not ${triple}`;
  }
  for (const file of manifest.files ?? []) {
    let stat;
    try {
      stat = fs.statSync(path.join(dir, file.path));
    } catch {
      return `its manifest lists ${file.path}, which the archive does not hold`;
    }
    if (stat.size !== file.size) {
      return `${file.path} is ${stat.size} bytes, its manifest says ${file.size}`;
    }
  }
  return undefined;
}

async function crossManifestOk(dir, triple) {
  return (
    fs.existsSync(path.join(dir, "manifest.json")) &&
    crossManifestProblem(dir, triple) === undefined
  );
}

async function fileMatches(file, artifact) {
  try {
    const st = await fsp.stat(file);
    if (artifact.size && st.size !== artifact.size) return false;
    return (await sha256File(file)) === artifact.sha256;
  } catch {
    return false;
  }
}

async function verifyOrThrow(file, artifact) {
  const actual = await sha256File(file);
  const st = await fsp.stat(file);
  if (actual !== artifact.sha256 || (artifact.size && st.size !== artifact.size)) {
    throw named(
      CHECKSUM_CODE,
      `${path.basename(file)}: expected sha256 ${artifact.sha256} (${artifact.size} bytes), actual ${actual} (${st.size} bytes)`,
    );
  }
}

async function sha256File(file) {
  const hash = createHash("sha256");
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest("hex");
}

function findBinary(root, candidates) {
  for (const candidate of candidates) {
    const file = path.join(root, candidate);
    try {
      if (fs.statSync(file).isFile()) return file;
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

function named(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

async function main() {
  const args = process.argv.slice(2);
  const opts = {};
  if (args.includes("--check")) opts.checkOnly = true;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--host") opts.host = args[++i];
    else if (args[i] === "--cache") opts.cacheDir = args[++i];
  }
  try {
    const info = await provision(opts);
    process.stdout.write(`${info.binaryPath}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

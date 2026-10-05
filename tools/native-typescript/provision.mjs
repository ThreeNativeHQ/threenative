#!/usr/bin/env node
// Provision the pinned ASDAlexander77/TypeScriptCompiler toolchain.
//
// Downloads the per-host archive named in compiler.lock.json into a cache
// outside the repository, verifies its SHA-256 before extracting, and prints
// the compiler binary path. A cached, verified toolchain is a cache hit and
// makes no network call. A checksum mismatch fails closed with the code
// TN_NATIVE_TS_CHECKSUM.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CHECKSUM_CODE = "TN_NATIVE_TS_CHECKSUM";

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

export function defaultCacheDir(lock, env = process.env) {
  const base =
    env.TN_NATIVE_TS_CACHE || path.join(os.homedir(), ".cache", "threenative", "native-typescript");
  return path.join(base, lock.tag);
}

export async function provision(opts = {}) {
  const lock = opts.lock ?? loadLock(opts.lockFile);
  const host = opts.host ?? resolveHost(lock);
  const artifact = lock.artifacts?.[host];
  if (!artifact) {
    throw named("TN_NATIVE_TS_HOST", `no pinned toolchain for host ${host}`);
  }
  const cacheDir = opts.cacheDir ?? defaultCacheDir(lock, opts.env);
  const toolchainDir = path.join(cacheDir, "toolchain");
  const archiveName = path.basename(new URL(artifact.url).pathname);
  const archivePath = path.join(cacheDir, archiveName);
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const log = opts.log ?? ((m) => process.stderr.write(`${m}\n`));

  await fsp.mkdir(cacheDir, { recursive: true });

  const archiveOk = await fileMatches(archivePath, artifact);
  const binary = () => findBinary(toolchainDir, lock.binaryCandidates);

  if (opts.checkOnly) {
    const found = archiveOk ? binary() : undefined;
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
      cacheHit: true,
    });
  }

  if (archiveOk) {
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
  } else if (fs.existsSync(archivePath)) {
    await verifyOrThrow(archivePath, artifact);
  } else {
    if (typeof fetchImpl !== "function") {
      throw named("TN_NATIVE_TS_FETCH", `no fetch available to download ${artifact.url}`);
    }
    log(`downloading ${artifact.url}`);
    await download(fetchImpl, artifact.url, archivePath);
    await verifyOrThrow(archivePath, artifact);
  }

  log("extracting");
  await fsp.rm(toolchainDir, { recursive: true, force: true });
  await fsp.mkdir(toolchainDir, { recursive: true });
  const tar = spawnSync("tar", ["-xzf", archivePath, "-C", toolchainDir], { stdio: "inherit" });
  if (tar.status !== 0) {
    throw named("TN_NATIVE_TS_EXTRACT", `tar exited ${tar.status} for ${archivePath}`);
  }

  const found = binary();
  if (!found) {
    throw named(
      "TN_NATIVE_TS_BINARY",
      `no compiler binary (${lock.binaryCandidates.join(", ")}) in the extracted toolchain`,
    );
  }
  return result({
    lock,
    host,
    artifact,
    cacheDir,
    toolchainDir,
    binaryPath: found,
    cacheHit: false,
  });
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

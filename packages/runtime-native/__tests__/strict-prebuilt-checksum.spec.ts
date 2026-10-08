/**
 * Strict packaging (PRD-530, Solution item 3): the two prebuilt kinds a strict build consumes are
 * checksum-pinned — the native SDK/runtime and the native-TypeScript compiler. Each kind must
 * accept a payload whose sha256 matches its pin, refuse a payload with one byte changed and leave
 * nothing installed, and refuse a declared pin that is not 64 lowercase hex. The prebuilt SDK
 * and the compiler both refuse a malformed pin before any download.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeTempDirSync } from "../../../test-support/temp-dir.js";
// @ts-expect-error -- plain ESM with no type declarations.
import { CHECKSUM_CODE, provision } from "../../../tools/native-typescript/provision.mjs";
// @ts-expect-error -- plain ESM with no type declarations.
import { downloadReleaseArtifact, installPrebuilt, sha256 } from "../scripts/install-prebuilt.mjs";

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(process.env, "THREENATIVE_ALLOW_INSECURE_PREBUILT");
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function tempRoot(prefix: string): string {
  const root = makeTempDirSync(prefix);
  roots.push(root);
  return root;
}

interface ILoopback {
  close: () => Promise<void>;
  hits: () => number;
  url: string;
}

/** Serves one payload over loopback and counts every request, so "no download" is observable. */
async function loopback(payload: Buffer): Promise<ILoopback> {
  let hits = 0;
  const server = createServer((_request, response) => {
    hits += 1;
    response.end(payload);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    url: `http://127.0.0.1:${address.port}/artifact`,
    hits: () => hits,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

function writeLock(
  path: string,
  artifacts: Record<string, { sha256: string; size?: number; url: string }>,
): void {
  writeFileSync(path, `${JSON.stringify({ artifacts })}\n`);
}

function tamperOneByte(bytes: Buffer): Buffer {
  const tampered = Buffer.from(bytes);
  tampered.writeUInt8(tampered.readUInt8(0) ^ 0xff, 0);
  return tampered;
}

describe("prebuilt native SDK artifacts are refused on checksum mismatch", () => {
  it("installs a payload whose sha256 matches the pinned checksum", async () => {
    const root = tempRoot("tn-strict-prebuilt-ok-");
    const runtime = Buffer.from("#!/bin/sh\necho verified\n");
    const tools = Buffer.from("#!/bin/sh\necho helper\n");
    const runtimeServer = await loopback(runtime);
    const toolsServer = await loopback(tools);
    try {
      process.env.THREENATIVE_ALLOW_INSECURE_PREBUILT = "1";
      const manifest = join(root, "prebuilt-lock.json");
      writeLock(manifest, {
        "linux-x64": { sha256: sha256(runtime), url: runtimeServer.url },
        "linux-x64-tools": { sha256: sha256(tools), url: toolsServer.url },
      });
      const output = join(root, "prebuilt", "linux-x64", "threenative-runtime");
      const statusPath = join(root, "prebuilt", "linux-x64", "install-status.json");

      await installPrebuilt({
        platform: "linux",
        arch: "x64",
        output,
        statusPath,
        manifestPath: manifest,
      });

      assert.deepEqual(readFileSync(output), runtime);
      const status = JSON.parse(readFileSync(statusPath, "utf8")) as {
        ok: boolean;
        sha256: string;
      };
      assert.equal(status.ok, true);
      assert.equal(status.sha256, sha256(runtime));
    } finally {
      await runtimeServer.close();
      await toolsServer.close();
    }
  });

  it("refuses a payload with one byte changed and installs nothing at the destination", async () => {
    const root = tempRoot("tn-strict-prebuilt-red-");
    const runtime = Buffer.from("#!/bin/sh\necho verified\n");
    const tools = Buffer.from("#!/bin/sh\necho helper\n");
    const runtimeServer = await loopback(tamperOneByte(runtime));
    const toolsServer = await loopback(tools);
    try {
      process.env.THREENATIVE_ALLOW_INSECURE_PREBUILT = "1";
      const manifest = join(root, "prebuilt-lock.json");
      writeLock(manifest, {
        "linux-x64": { sha256: sha256(runtime), url: runtimeServer.url },
        "linux-x64-tools": { sha256: sha256(tools), url: toolsServer.url },
      });
      const output = join(root, "prebuilt", "linux-x64", "threenative-runtime");
      const helper = join(root, "prebuilt", "linux-x64", "mystral-tools");
      const statusPath = join(root, "prebuilt", "linux-x64", "install-status.json");

      const error = await installPrebuilt({
        platform: "linux",
        arch: "x64",
        output,
        statusPath,
        manifestPath: manifest,
      }).catch((cause: unknown) => cause as Error & { code?: string });

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toMatch(/Checksum verification failed.*linux-x64/u);
      expect(existsSync(output)).toBe(false);
      expect(existsSync(helper)).toBe(false);
      expect((JSON.parse(readFileSync(statusPath, "utf8")) as { ok: boolean }).ok).toBe(false);
    } finally {
      await runtimeServer.close();
      await toolsServer.close();
    }
  });

  it("refuses a declared checksum that is not 64 lowercase hex before any download", async () => {
    const root = tempRoot("tn-strict-prebuilt-format-");
    const payload = Buffer.from("verified runtime");
    const server = await loopback(payload);
    try {
      process.env.THREENATIVE_ALLOW_INSECURE_PREBUILT = "1";
      const manifest = join(root, "prebuilt-lock.json");
      const good = sha256(payload);
      for (const declared of ["abc", good.toUpperCase(), good.slice(0, 63)]) {
        writeLock(manifest, { "linux-x64": { sha256: declared, url: server.url } });
        await expect(
          downloadReleaseArtifact("linux-x64", { manifestPath: manifest }),
        ).rejects.toThrow(/Invalid prebuilt SHA-256.*linux-x64/u);
      }
      expect(server.hits()).toBe(0);
    } finally {
      await server.close();
    }
  });
});

const COMPILER = "#!/bin/sh\necho ok\n";
const ARCHIVE_NAME = "toolchain.tgz";
const ARCHIVE_URL = `https://example.invalid/${ARCHIVE_NAME}`;

/** A real gzipped tar holding one `tslang`, so extraction can actually run. */
function buildArchive(archivePath: string, contents: string): Buffer {
  const staging = `${archivePath}.src`;
  mkdirSync(staging, { recursive: true });
  writeFileSync(join(staging, "tslang"), contents);
  const tar = spawnSync("tar", ["-czf", archivePath, "-C", staging, "tslang"]);
  if (tar.status !== 0) throw new Error(`tar failed: ${tar.status}`);
  return readFileSync(archivePath);
}

function compilerLock(checksum: string, size: number) {
  return {
    tag: "v0.0-test",
    binaryCandidates: ["tslang"],
    artifacts: { "linux-x64-test": { url: ARCHIVE_URL, sha256: checksum, size } },
    hostPreference: {},
  };
}

describe("native-TypeScript compiler artifacts are refused on checksum mismatch", () => {
  it("accepts and extracts an archive whose sha256 matches the pinned checksum", async () => {
    const cacheDir = tempRoot("tn-strict-compiler-ok-");
    const bytes = buildArchive(join(cacheDir, ARCHIVE_NAME), COMPILER);

    const info = await provision({
      lock: compilerLock(sha256(bytes), bytes.length),
      host: "linux-x64-test",
      cacheDir,
      fetchImpl: () => {
        throw new Error("network must not be used");
      },
      log: () => {},
    });

    expect(info.cacheHit).toBe(false);
    expect(readFileSync(info.binaryPath, "utf8")).toBe(COMPILER);
  });

  it("refuses an archive with one byte changed and leaves no archive or toolchain behind", async () => {
    const root = tempRoot("tn-strict-compiler-red-");
    const cacheDir = join(root, "cache");
    mkdirSync(cacheDir, { recursive: true });
    const bytes = buildArchive(join(root, ARCHIVE_NAME), COMPILER);
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array(tamperOneByte(bytes))));

    const error = await provision({
      lock: compilerLock(sha256(bytes), bytes.length),
      host: "linux-x64-test",
      cacheDir,
      fetchImpl,
      log: () => {},
    }).catch((cause: unknown) => cause as Error & { code?: string });

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe(CHECKSUM_CODE);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(existsSync(join(cacheDir, ARCHIVE_NAME))).toBe(false);
    expect(existsSync(join(cacheDir, `${ARCHIVE_NAME}.part`))).toBe(false);
    expect(existsSync(join(cacheDir, "toolchain"))).toBe(false);
  });

  it("refuses a declared checksum that is not 64 lowercase hex before any download", async () => {
    const cacheDir = tempRoot("tn-strict-compiler-format-");
    const fetchImpl = vi.fn(async () => new Response("payload"));

    const error = await provision({
      lock: compilerLock("not-a-checksum", 7),
      host: "linux-x64-test",
      cacheDir,
      fetchImpl,
      log: () => {},
    }).catch((cause: unknown) => cause as Error & { code?: string });

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe(CHECKSUM_CODE);
    expect(existsSync(join(cacheDir, ARCHIVE_NAME))).toBe(false);
    expect(existsSync(join(cacheDir, "toolchain"))).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

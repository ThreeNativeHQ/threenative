import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CHECKSUM_CODE, provision } from "../provision.mjs";

function tempCache() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tn-provision-"));
}

function lockFor(url: string, sha256: string, size: number) {
  return {
    tag: "v0.0-test",
    binaryCandidates: ["tslang"],
    artifacts: { "linux-x64-test": { url, sha256, size } },
    hostPreference: {},
  };
}

const ARCHIVE_URL = "https://example.invalid/toolchain.tgz";
const ARCHIVE_NAME = "toolchain.tgz";

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** A real gzipped tar holding one `tslang`, so extraction can actually run. */
function makeArchive(cacheDir: string, contents = "#!/bin/sh\n"): { path: string; sha: string } {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "tn-provision-src-"));
  fs.writeFileSync(path.join(source, "tslang"), contents);
  const archivePath = path.join(cacheDir, ARCHIVE_NAME);
  const tar = spawnSync("tar", ["-czf", archivePath, "-C", source, "tslang"]);
  if (tar.status !== 0) throw new Error(`tar failed: ${tar.status}`);
  return { path: archivePath, sha: sha256(fs.readFileSync(archivePath)) };
}

describe("provision", () => {
  it("refuses a tampered archive with TN_NATIVE_TS_CHECKSUM", async () => {
    const cacheDir = tempCache();
    const lock = lockFor("https://example.invalid/toolchain.tgz", "a".repeat(64), 8);
    fs.writeFileSync(path.join(cacheDir, "toolchain.tgz"), "tampered");
    const fetchImpl = vi.fn(() => {
      throw new Error("network must not be used");
    });

    const error = await provision({
      lock,
      host: "linux-x64-test",
      cacheDir,
      fetchImpl,
      log: () => {},
    }).catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe(CHECKSUM_CODE);
    expect(error.message).toContain("a".repeat(64));
    expect(error.message).toMatch(/expected .* actual/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("is a cache hit with no download when the verified marker matches", async () => {
    const cacheDir = tempCache();
    const bytes = Buffer.from("fake archive bytes");
    const sha256Hex = sha256(bytes);
    fs.writeFileSync(path.join(cacheDir, ARCHIVE_NAME), bytes);
    fs.writeFileSync(path.join(cacheDir, ".verified"), `${sha256Hex}\n`);
    const toolchain = path.join(cacheDir, "toolchain");
    fs.mkdirSync(toolchain, { recursive: true });
    fs.writeFileSync(path.join(toolchain, "tslang"), "#!/bin/sh\n");
    const fetchImpl = vi.fn(() => {
      throw new Error("network must not be used");
    });
    const logs: string[] = [];

    const info = await provision({
      lock: lockFor(ARCHIVE_URL, sha256Hex, bytes.length),
      host: "linux-x64-test",
      cacheDir,
      fetchImpl,
      log: (message: string) => logs.push(message),
    });

    expect(info.cacheHit).toBe(true);
    expect(info.binaryPath).toBe(path.join(toolchain, "tslang"));
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(logs).toContain("cache hit");
  });

  it("re-extracts when the marker is missing, even though a stale binary is present", async () => {
    const cacheDir = tempCache();
    const archive = makeArchive(cacheDir);
    const toolchain = path.join(cacheDir, "toolchain");
    fs.mkdirSync(toolchain, { recursive: true });
    fs.writeFileSync(path.join(toolchain, "tslang"), "stale, half-extracted\n");

    const info = await provision({
      lock: lockFor(ARCHIVE_URL, archive.sha, fs.readFileSync(archive.path).length),
      host: "linux-x64-test",
      cacheDir,
      fetchImpl: () => {
        throw new Error("network must not be used");
      },
      log: () => {},
    });

    expect(info.cacheHit).toBe(false);
    expect(fs.readFileSync(path.join(toolchain, "tslang"), "utf8")).toBe("#!/bin/sh\n");
    expect(fs.readFileSync(path.join(cacheDir, ".verified"), "utf8").trim()).toBe(archive.sha);
  });

  it("deletes a corrupt .part instead of publishing it", async () => {
    const cacheDir = tempCache();
    const fetchImpl = vi.fn(async () => new Response("tampered"));

    const error = await provision({
      lock: lockFor(ARCHIVE_URL, "a".repeat(64), 8),
      host: "linux-x64-test",
      cacheDir,
      fetchImpl,
      log: () => {},
    }).catch((e) => e);

    expect(error.code).toBe(CHECKSUM_CODE);
    expect(fs.existsSync(path.join(cacheDir, `${ARCHIVE_NAME}.part`))).toBe(false);
    expect(fs.existsSync(path.join(cacheDir, ARCHIVE_NAME))).toBe(false);
  });
});

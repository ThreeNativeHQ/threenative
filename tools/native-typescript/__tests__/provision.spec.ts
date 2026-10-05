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

  it("is a cache hit with no download", async () => {
    const cacheDir = tempCache();
    const bytes = Buffer.from("fake archive bytes");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    fs.writeFileSync(path.join(cacheDir, "toolchain.tgz"), bytes);
    const toolchain = path.join(cacheDir, "toolchain");
    fs.mkdirSync(toolchain, { recursive: true });
    fs.writeFileSync(path.join(toolchain, "tslang"), "#!/bin/sh\n");
    const fetchImpl = vi.fn(() => {
      throw new Error("network must not be used");
    });
    const logs: string[] = [];

    const info = await provision({
      lock: lockFor("https://example.invalid/toolchain.tgz", sha256, bytes.length),
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
});

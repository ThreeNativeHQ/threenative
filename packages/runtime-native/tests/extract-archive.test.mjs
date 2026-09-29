import { describe, expect, it, vi } from "vitest";
import { makeTempDir } from "../../../test-support/temp-dir.js";

// On the Windows runner the PATH `tar` was Git's GNU tar: it read `D:\a\...` as a remote host
// ("Cannot connect to D: resolve failed") and mangled `C:\Users\...` in -C. Windows ships bsdtar in
// System32, which takes native paths as they are.
const calls = vi.hoisted(() => []);
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    execFileSync: (file, args, options) => {
      calls.push({ file, args, options });
      return Buffer.alloc(0);
    },
  };
});

const { extractArchive, tarBinary } = await import("../scripts/download-deps.mjs");

describe("tarBinary", () => {
  it("uses the System32 bsdtar on Windows and PATH tar elsewhere", () => {
    expect(tarBinary("win32", { SystemRoot: "C:\\Windows" })).toBe("C:\\Windows\\System32\\tar.exe");
    expect(tarBinary("win32", {})).toBe("C:\\Windows\\System32\\tar.exe");
    expect(tarBinary("linux", {})).toBe("tar");
    expect(tarBinary("darwin", {})).toBe("tar");
  });
});

describe("extractArchive", () => {
  it("hands tar the native archive and destination paths unchanged, without a shell", async () => {
    const destination = await makeTempDir("tn-extract-archive-");
    const archive = "D:\\a\\deps\\openriglogic.tar.gz";
    await extractArchive(archive, destination);
    const tar = calls.at(-1);
    expect(tar.file).toBe(tarBinary());
    expect(tar.args).toEqual(["-xzf", archive, "-C", destination]);
  });
});

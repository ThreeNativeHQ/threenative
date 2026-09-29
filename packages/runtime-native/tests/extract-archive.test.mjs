import { describe, expect, it, vi } from "vitest";
import { makeTempDir } from "../../../test-support/temp-dir.js";

// GNU tar reads `host:path` in its archive argument as a remote archive when the colon comes before
// the first slash, and a Windows drive path (`D:\a\...`) is exactly that shape: the OpenRigLogic
// source archive failed on the Windows runner with "Cannot connect to D: resolve failed". A Linux
// absolute path never has that shape, so pin the invocation instead of the host's tar.
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

const { extractArchive } = await import("../scripts/download-deps.mjs");

describe("extractArchive", () => {
  it("never hands tar a drive-letter archive path", async () => {
    const destination = await makeTempDir("tn-extract-archive-");
    await extractArchive("D:/a/deps/openriglogic.tar.gz", destination);

    const tar = calls.find((call) => call.file === "tar");
    expect(tar).toBeDefined();
    const archiveArgument = tar.args[tar.args.indexOf("-xzf") + 1];
    expect(archiveArgument).toBe("openriglogic.tar.gz");
    expect(archiveArgument.includes(":")).toBe(false);
    expect(tar.options.cwd).toBe("D:/a/deps");
  });
});

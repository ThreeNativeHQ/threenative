/**
 * A desktop distributable ships the runtime's code, not its debug information.
 *
 * The packager copies the runtime into the release container; that copy is the only file a player
 * installs, so it is the copy that gets stripped. The build-tree original keeps its symbols. Linux
 * drops every symbol, macOS `-x` keeps the exports the dynamic loader needs, and Windows has no
 * strip step — and no `.pdb` ever enters the container's copy list.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// @ts-expect-error -- the packagers are plain ESM with no type declarations.
import { packageDesktopContainer } from "../scripts/desktop-distribution.mjs";
// @ts-expect-error -- the packagers are plain ESM with no type declarations.
import { stripDesktopRuntime } from "../scripts/package-desktop.mjs";

function fixture(contents = "runtime bytes") {
  const directory = mkdtempSync(join(tmpdir(), "tn-desktop-strip-"));
  const file = join(directory, "mystral");
  writeFileSync(file, contents);
  return { directory, file, cleanup: () => rmSync(directory, { force: true, recursive: true }) };
}

describe("stripDesktopRuntime", () => {
  it("linux runs strip --strip-all against the copy", () => {
    const { file, cleanup } = fixture();
    const run = vi.fn(() => ({ status: 0, stdout: "", stderr: "" }));
    try {
      expect(stripDesktopRuntime(file, { platform: "linux", run })).toEqual({
        stripped: true,
        command: "strip",
      });
      expect(run).toHaveBeenCalledWith("strip", ["--strip-all", file], expect.anything());
    } finally {
      cleanup();
    }
  });

  it("linux falls back to llvm-strip only when strip is absent", () => {
    const { file, cleanup } = fixture();
    const run = vi.fn((command: string) =>
      command === "strip"
        ? { error: new Error("spawnSync strip ENOENT"), status: null, stderr: "" }
        : { status: 0, stdout: "", stderr: "" },
    );
    try {
      expect(stripDesktopRuntime(file, { platform: "linux", run })).toEqual({
        stripped: true,
        command: "llvm-strip",
      });
      expect(run.mock.calls.map(([command]) => command)).toEqual(["strip", "llvm-strip"]);
    } finally {
      cleanup();
    }
  });

  it.each([
    ["darwin", "darwin"],
    ["win32", "win32"],
  ])("%s runs no strip tool (a stripped Mach-O loses its launch signature)", (platform, reason) => {
    const { file, cleanup } = fixture();
    const run = vi.fn(() => ({ status: 0 }));
    try {
      expect(stripDesktopRuntime(file, { platform, run })).toEqual({ stripped: false, reason });
      expect(run).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it("a missing tool warns with the unstripped size instead of throwing", () => {
    const { file, cleanup } = fixture("0123456789ab");
    const run = vi.fn(() => ({ error: new Error("spawnSync ENOENT"), status: null, stderr: "" }));
    const warn = vi.fn();
    try {
      expect(() => stripDesktopRuntime(file, { platform: "linux", run, warn })).not.toThrow();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toMatch(/no strip tool on PATH/u);
      expect(warn.mock.calls[0]?.[0]).toMatch(/\(12 bytes\)/u);
    } finally {
      cleanup();
    }
  });

  it("a strip tool that runs and fails fails the packaging with its stderr", () => {
    const { file, cleanup } = fixture();
    const run = vi.fn(() => ({ status: 1, stdout: "", stderr: "file format not recognized" }));
    try {
      expect(() => stripDesktopRuntime(file, { platform: "linux", run })).toThrow(
        /TN_DESKTOP_STRIP_FAILED.*file format not recognized/su,
      );
    } finally {
      cleanup();
    }
  });
});

describe("windows container copy list", () => {
  it("carries no .pdb file", () => {
    const directory = mkdtempSync(join(tmpdir(), "tn-desktop-pdb-"));
    try {
      const executable = join(directory, "game.exe");
      const bundle = join(directory, "game.bundle");
      writeFileSync(executable, "MZ runtime fixture");
      writeFileSync(bundle, "game bundle fixture");
      const output = join(directory, "game");
      const run = (command: string, args: string[], _options?: unknown) => {
        if (command === "makensis") {
          const script = args.at(-1);
          const out = script
            ? /^OutFile "([^"]+)"$/mu.exec(readFileSync(script, "utf8"))?.[1]
            : undefined;
          if (!out) throw new Error("the NSIS fixture script names no OutFile");
          writeFileSync(out, "MZ installer fixture");
          return { status: 0, stdout: "", stderr: "" };
        }
        // The packager's first zip writer wins; give it the local file header a real zip starts
        // with and let the (unchanged) archiving path run.
        const candidate = args[2];
        if (!candidate) throw new Error("the zip fixture expected a candidate archive path");
        writeFileSync(candidate, Buffer.from([0x50, 0x4b, 0x03, 0x04]));
        return { status: 0, stdout: "", stderr: "" };
      };
      const result = packageDesktopContainer({
        platform: "win32",
        arch: "x64",
        bundle,
        executable,
        output,
        run,
      });
      expect(Object.keys(result.manifest.resources).some((path) => path.endsWith(".pdb"))).toBe(
        false,
      );
      expect(result.manifest.executable.endsWith(".pdb")).toBe(false);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});

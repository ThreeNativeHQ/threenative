import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rgbaPng } from "../../../test-support/png.js";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { basisTranscoderPaths } from "../../../test-support/three-basis.js";
import {
  type IAssetPass,
  type IAssetWatchHandle,
  type IAssetWatchSummary,
  watchAssets,
} from "../src/index.js";

const DEBOUNCE_MS = 25;
// The burst test needs a window wider than the burst that is supposed to fit inside it. 60ms was
// wide enough on an idle machine and not on a loaded CI runner, where five sequential writes to a
// container filesystem overran it: the watcher then compiled after write 1, and the test failed on
// the compiled content rather than on the coalescing it exists to check. This is that window with
// room to spare, and the test measures the burst against it rather than assuming it fits.
const BURST_DEBOUNCE_MS = 500;

interface IBurstRecorder {
  onChange(summary: IAssetWatchSummary): void;
  readonly summaries: IAssetWatchSummary[];
  waitForCount(target: number): Promise<void>;
}

/** Collects burst summaries and lets tests await a deterministic burst count instead of sleeps. */
function createBurstRecorder(): IBurstRecorder {
  const summaries: IAssetWatchSummary[] = [];
  const waiters: Array<() => void> = [];
  return {
    onChange: (summary) => {
      summaries.push(summary);
      for (const waiter of waiters.splice(0)) waiter();
    },
    summaries,
    waitForCount: (target) =>
      summaries.length >= target
        ? Promise.resolve()
        : new Promise((resolve) => {
            waiters.push(() => {
              if (summaries.length >= target) resolve();
            });
          }),
  };
}

const openHandles: IAssetWatchHandle[] = [];

afterEach(() => {
  for (const handle of openHandles.splice(0)) handle.close();
});

interface IManifestEntry {
  readonly format?: string;
  readonly output: string;
}

function requireEntry(
  entries: Record<string, IManifestEntry | undefined>,
  logical: string,
): IManifestEntry {
  const entry = entries[logical];
  if (entry === undefined || entry.output === undefined) {
    throw new Error(`manifest has no usable '${logical}' entry`);
  }
  return entry;
}

function readManifestEntries(manifestPath: string): Promise<Record<string, IManifestEntry>> {
  return readFile(manifestPath, "utf8").then((raw): Record<string, IManifestEntry> => {
    const entries = (JSON.parse(raw) as { entries?: Record<string, IManifestEntry> }).entries;
    return entries ?? {};
  });
}

describe("watchAssets", () => {
  it("should serve a Meshopt-compressed source byte-identical under models: none on the initial compile", async () => {
    // Wildwood's dev watcher died on its initial compile: the health pass could not decode a
    // Meshopt source, so no manifest was written and the game served whatever stale public/
    // copy was left from an older build. `models: "none"` promises the served bytes are the
    // source bytes; the watcher's first compile must honour that for a compressed source.
    const { buildFixtureGlb } = await import("../../../test-support/generate-fixture-model.js");
    const { modelPass } = await import("../src/passes/model.js");
    const compressed = await modelPass().apply(Buffer.from(await buildFixtureGlb()), "pine.glb");
    if (Buffer.isBuffer(compressed)) throw new Error("the model pass did not compress the fixture");
    const root = await makeTempDir("threenative-watch-meshopt-");
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "assets", "pine.glb"), compressed.buffer);
    openHandles.push(
      watchAssets({
        config: { models: "none" },
        cwd: root,
        debounceMs: DEBOUNCE_MS,
        onChange: () => {},
      }),
    );
    await openHandles[0]?.ready;

    const publicDirectory = path.join(root, "public");
    const entries = await readManifestEntries(path.join(publicDirectory, "assets.manifest.json"));
    const served = await readFile(
      path.join(publicDirectory, requireEntry(entries, "pine.glb").output),
    );
    const sha = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
    expect(sha(served)).toBe(sha(compressed.buffer));
  });

  it("should recompile only the changed input", async () => {
    const root = await makeTempDir("threenative-watch-changed-");
    await mkdir(path.join(root, "assets"));
    await writeFile(
      path.join(root, "assets", "rock.png"),
      rgbaPng({ height: 64, red: (x) => x * 4, width: 64 }),
    );
    await writeFile(
      path.join(root, "assets", "shield.png"),
      rgbaPng({ blue: () => 90, green: () => 200, height: 32, width: 32 }),
    );
    const recorder = createBurstRecorder();
    openHandles.push(
      watchAssets({
        cwd: root,
        debounceMs: DEBOUNCE_MS,
        onChange: recorder.onChange,
        transcoder: basisTranscoderPaths(),
      }),
    );
    await openHandles[0]?.ready;

    const publicDirectory = path.join(root, "public");
    const manifestPath = path.join(publicDirectory, "assets.manifest.json");
    const initialEntries = await readManifestEntries(manifestPath);
    expect(requireEntry(initialEntries, "rock.png").format).toBe("etc1s");
    const knightPath = path.join(
      publicDirectory,
      requireEntry(initialEntries, "shield.png").output,
    );
    const knightMtimeBefore = (await stat(knightPath)).mtimeMs;

    await writeFile(
      path.join(root, "assets", "rock.png"),
      rgbaPng({ height: 64, red: (x) => 255 - x * 4, width: 64 }),
    );
    await recorder.waitForCount(1);

    // The burst carries the same per-pass cost records a build emits (PRD-318).
    expect(recorder.summaries[0]).toEqual({
      compiled: ["rock.png"],
      failed: [],
      passCosts: expect.any(Array),
    });
    expect(recorder.summaries[0]?.passCosts?.map((row) => row.pass)).toEqual(["ktx2", "model"]);
    expect(
      recorder.summaries[0]?.passCosts?.every(
        (row) => row.status === "ran" && row.ranInputs === 1 && row.cachedInputs === 0,
      ),
    ).toBe(true);
    const updatedEntries = await readManifestEntries(manifestPath);
    expect(requireEntry(updatedEntries, "rock.png").output).not.toBe(
      requireEntry(initialEntries, "rock.png").output,
    );
    const recompiled = await readFile(
      path.join(publicDirectory, requireEntry(updatedEntries, "rock.png").output),
    );
    // The dev save produced what a build would: KTX2 bytes, not the raw source.
    expect([...recompiled.subarray(1, 7)].map((byte) => String.fromCharCode(byte)).join("")).toBe(
      "KTX 20",
    );
    expect(requireEntry(updatedEntries, "rock.png").format).toBe("etc1s");
    expect(updatedEntries["shield.png"]).toEqual(initialEntries["shield.png"]);
    expect((await stat(knightPath)).mtimeMs).toBe(knightMtimeBefore);
  });

  it("should keep the previous output when compilation throws", async () => {
    const root = await makeTempDir("threenative-watch-throws-");
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "assets", "rock.png"), "good png");
    const explode: IAssetPass = {
      name: "explode",
      apply: (input) => {
        if (input.toString("utf8").includes("corrupt")) throw new Error("boom");
        return input;
      },
    };
    const recorder = createBurstRecorder();
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
    try {
      openHandles.push(
        watchAssets({
          cwd: root,
          debounceMs: DEBOUNCE_MS,
          onChange: recorder.onChange,
          passes: [explode],
        }),
      );
      await openHandles[0]?.ready;

      const publicDirectory = path.join(root, "public");
      const manifestPath = path.join(publicDirectory, "assets.manifest.json");
      const manifestRaw = await readFile(manifestPath, "utf8");
      const rockOutput = requireEntry(await readManifestEntries(manifestPath), "rock.png").output;
      const outputPath = path.join(publicDirectory, rockOutput);
      const bytesBefore = await readFile(outputPath);

      await writeFile(path.join(root, "assets", "rock.png"), "corrupt png");
      await recorder.waitForCount(1);

      expect(recorder.summaries[0]).toEqual({ compiled: [], failed: ["rock.png"] });
      const logged = stderrSpy.mock.calls.map((call) => String(call[0])).join("");
      expect(logged).toMatch(/TN_ASSETS_WATCH_FAILED/u);
      expect(logged).toMatch(/rock\.png/u);
      expect(await readFile(manifestPath, "utf8")).toBe(manifestRaw);
      expect((await readFile(outputPath)).equals(bytesBefore)).toBe(true);
      // The receipt is part of a successful compile's output, so the last good one survives the
      // failure exactly as the manifest and the compiled bytes do.
      expect(await readdir(publicDirectory)).toEqual(
        ["assets.manifest.json", "bake.receipt.json", rockOutput].sort(),
      );

      // Fixing the input heals the deviation: the next burst recompiles and updates the manifest.
      await writeFile(path.join(root, "assets", "rock.png"), "fixed png");
      await recorder.waitForCount(2);
      expect(recorder.summaries[1]).toEqual({
        compiled: ["rock.png"],
        failed: [],
        passCosts: expect.any(Array),
      });
      expect(recorder.summaries[1]?.passCosts?.map((row) => row.pass)).toEqual(["explode"]);
      expect(await readFile(manifestPath, "utf8")).not.toBe(manifestRaw);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("should debounce a burst of writes into one recompile", async () => {
    const root = await makeTempDir("threenative-watch-debounce-");
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "assets", "rock.png"), "before burst");
    const recorder = createBurstRecorder();
    // Identity compilation keeps the assertion on coalescing itself rather than on encoding.
    openHandles.push(
      watchAssets({
        cwd: root,
        config: { textures: "none" },
        debounceMs: BURST_DEBOUNCE_MS,
        onChange: recorder.onChange,
      }),
    );
    await openHandles[0]?.ready;

    const burstStartedAt = Date.now();
    for (let index = 1; index <= 5; index += 1) {
      await writeFile(path.join(root, "assets", "rock.png"), `burst write ${index}`);
    }
    const burstMs = Date.now() - burstStartedAt;
    // Fail on the premise, not on a downstream symptom. A burst that outruns its own debounce
    // window is not a coalescing bug: the writes were never in one window to begin with, and every
    // assertion below would be measuring a machine, not the watcher.
    expect(
      burstMs,
      `the burst took ${burstMs}ms and does not fit the ${BURST_DEBOUNCE_MS}ms window it is meant to coalesce inside; raise BURST_DEBOUNCE_MS rather than trusting the assertions below`,
    ).toBeLessThan(BURST_DEBOUNCE_MS);
    await recorder.waitForCount(1);
    // Any straggler event outside the debounced burst would have fired well within 3 windows.
    await new Promise((resolve) => setTimeout(resolve, BURST_DEBOUNCE_MS * 3));

    expect(recorder.summaries).toHaveLength(1);
    expect(recorder.summaries[0]).toEqual({
      compiled: ["rock.png"],
      failed: [],
      passCosts: expect.any(Array),
    });
    // textures: "none" drops the ktx2 pass; the model pass still ran and reports itself.
    expect(recorder.summaries[0]?.passCosts?.map((row) => row.pass)).toEqual(["model"]);
    const entries = await readManifestEntries(path.join(root, "public", "assets.manifest.json"));
    const compiled = await readFile(
      path.join(root, "public", requireEntry(entries, "rock.png").output),
      "utf8",
    );
    expect(compiled).toBe("burst write 5");
  });
});

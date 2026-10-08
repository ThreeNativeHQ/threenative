import { describe, expect, it } from "vitest";
import { makeTempDirSync } from "../../../test-support/temp-dir.js";

describe("native-AOT driver", () => {
  it("parses sizes as positive integers and requires an output file", async () => {
    const { parseArgs } = await import("../bench-aot.mjs");
    expect(
      parseArgs(["--out", "/tmp/r.json", "--objects", "64", "--frames", "20", "--warmup", "5"]),
    ).toMatchObject({ out: "/tmp/r.json", objects: 64, frames: 20, warmup: 5, width: 1280 });
    expect(() => parseArgs([])).toThrow("TN_BENCH_AOT_USAGE");
    expect(() => parseArgs(["--out", "/tmp/r.json", "--objects", "0"])).toThrow("positive integer");
    expect(() => parseArgs(["--out", "/tmp/r.json", "--objects", "x"])).toThrow("positive integer");
    expect(() => parseArgs(["--out", "/tmp/r.json", "--bogus", "1"])).toThrow("unknown argument");
  });

  it("keys the cached binary by the bytes it is built from", async () => {
    const { sourceKey } = await import("../bench-aot.mjs");
    const { writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = makeTempDirSync("bench-aot-key-");
    const a = join(dir, "a.ts");
    writeFileSync(a, "one");
    const first = sourceKey([a]);
    expect(sourceKey([a])).toBe(first);
    writeFileSync(a, "two");
    expect(sourceKey([a])).not.toBe(first);
    // ...and by the engine archives it links: touching one rebuilds the game.
    writeFileSync(a, "one");
    const archive = join(dir, "libtn_engine_renderer.a");
    writeFileSync(archive, "x");
    const linked = sourceKey([a], dir);
    expect(sourceKey([a], dir)).toBe(linked);
    const { utimesSync } = await import("node:fs");
    utimesSync(archive, new Date(2030, 0, 1), new Date(2030, 0, 1));
    expect(sourceKey([a], dir)).not.toBe(linked);
  });
});

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { makeTempDirSync } from "../../../test-support/temp-dir.js";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const kit = join(packageRoot, "starter", "forest");

interface IBaked {
  size: number;
  resolution: number;
  heights: number[];
  colors: number[];
  placements: {
    id: string;
    asset: string;
    position: number[];
    quaternion: number[];
    scale: number[];
  }[];
  lakes: { id: string; at: number[]; radius: number; level: number }[];
  rivers: { id: string }[];
  waterLevel: number | null;
}

/** Copies the kit into a temp directory whose node_modules resolves the workspace package. */
function kitInTempDir(): string {
  const dir = makeTempDirSync("terrain-starter-kit-");
  copyFileSync(join(kit, "world.json"), join(dir, "world.json"));
  copyFileSync(join(kit, "bake.mjs"), join(dir, "bake.mjs"));
  mkdirSync(join(dir, "node_modules", "@threenative"), { recursive: true });
  symlinkSync(packageRoot, join(dir, "node_modules", "@threenative", "terrain"), "dir");
  return dir;
}

function bake(dir: string): { bytes: string; doc: IBaked } {
  execFileSync(process.execPath, ["bake.mjs"], { cwd: dir, stdio: "pipe" });
  const bytes = readFileSync(join(dir, "baked.json"), "utf8");
  return { bytes, doc: JSON.parse(bytes) as IBaked };
}

describe("forest starter kit", () => {
  it("bakes a 512 m forest with firs, boulders and ferns, deterministically", () => {
    const dir = kitInTempDir();
    const first = bake(dir);
    const { doc } = first;

    expect(doc.size).toBe(512);
    expect(doc.resolution).toBe(257);
    expect(doc.heights).toHaveLength(doc.resolution ** 2);
    expect(doc.colors).toHaveLength(doc.resolution ** 2 * 3);
    expect(doc.heights.every(Number.isFinite)).toBe(true);

    const perAsset: Record<string, number> = {};
    for (const placement of doc.placements) {
      expect(typeof placement.id).toBe("string");
      expect(placement.id.length).toBeGreaterThan(0);
      expect(["fir", "boulder", "fern"]).toContain(placement.asset);
      expect([...placement.position, ...placement.scale].every(Number.isFinite)).toBe(true);
      expect(placement.quaternion).toHaveLength(4);
      expect(placement.quaternion.every(Number.isFinite)).toBe(true);
      expect(Math.abs(Math.hypot(...placement.quaternion) - 1)).toBeLessThan(1e-5);
      perAsset[placement.asset] = (perAsset[placement.asset] ?? 0) + 1;
    }
    expect(perAsset.fir).toBeGreaterThanOrEqual(2000);
    expect(perAsset.boulder).toBe(140);
    expect(perAsset.fern).toBe(1800);

    expect(doc.lakes.map((lake) => lake.id)).toContain("lake");
    expect(doc.rivers.map((river) => river.id)).toContain("river");
    expect(doc.waterLevel).toBeNull();

    // One recipe and seed, one output: re-running is byte-identical.
    expect(bake(dir).bytes).toBe(first.bytes);
  });

  it("ships the kit and its starter assets inside 25 MiB", () => {
    const packed = JSON.parse(
      execFileSync("npm", ["pack", "--dry-run", "--json"], {
        cwd: packageRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    ) as { files: { path: string; size: number }[] }[];
    const packedFiles = packed[0]?.files ?? [];
    const files = new Map(packedFiles.map((file) => [file.path, file.size]));
    for (const path of [
      "starter/forest/world.json",
      "starter/forest/bake.mjs",
      "starter-assets/fir_tree_01/fir-b-near.glb",
    ])
      expect(files.has(path), `packed tarball is missing ${path}`).toBe(true);
    const kitBytes = packedFiles
      .filter(
        (file) =>
          file.path.startsWith("starter/forest/") || file.path.startsWith("starter-assets/"),
      )
      .reduce((total, file) => total + file.size, 0);
    expect(kitBytes).toBeLessThanOrEqual(25 * 1024 * 1024);
  });
});

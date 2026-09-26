import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type IWorldPackage, validateWorldPackage } from "../src/world.js";

/**
 * The committed v1 fixture is recipe output: `blender_export_world` ran over a generated .blend
 * and wrote this directory. Reading it from disk keeps the contract honest without a Blender in
 * the lane — a change to `world-package.ts` that stopped accepting real exporter output fails here.
 */

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "world-v1");

describe("committed world package fixture", () => {
  it("validates against the v1 contract using the real byte lengths", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(fixture, "world.json"), "utf8"),
    ) as IWorldPackage;
    const placements = readFileSync(path.join(fixture, "placements.bin"));
    const heightmap = readFileSync(path.join(fixture, "terrain", "heightmap.u16"));

    const validation = validateWorldPackage(manifest, {
      heightmapByteLength: heightmap.byteLength,
      placementsByteLength: placements.byteLength,
    });
    expect(validation.errors, JSON.stringify(validation.errors)).toEqual([]);
    expect(validation.ok).toBe(true);
  });

  it("sizes the binaries exactly as the manifest describes them", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(fixture, "world.json"), "utf8"),
    ) as IWorldPackage;
    const placements = readFileSync(path.join(fixture, "placements.bin"));
    const heightmap = readFileSync(path.join(fixture, "terrain", "heightmap.u16"));

    expect(heightmap.byteLength).toBe(manifest.terrain.columns * manifest.terrain.rows * 2);
    const records = manifest.cells
      .flatMap((cell) => cell.runs)
      .reduce((highest, run) => Math.max(highest, run.offset + run.count), 0);
    expect(placements.byteLength).toBe(records * 32);
  });
});

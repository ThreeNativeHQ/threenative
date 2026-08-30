import { describe, expect, it } from "vitest";
import { formatModelSizes, formatTextureSizes } from "../src/report.js";
import type { IModelSizeRow, ITextureSizeRow } from "../src/report.js";

describe("formatTextureSizes", () => {
  it("should report a smaller total after compression", async () => {
    const rows: readonly ITextureSizeRow[] = [
      { after: 51_234, before: 184_320, format: "etc1s", logicalPath: "rock.png" },
      { after: 210_000, before: 700_000, format: "uastc", logicalPath: "props/decal.png" },
    ];
    const lines = formatTextureSizes(rows);

    expect(lines).toEqual([
      "texture rock.png (etc1s): 184320 -> 51234 bytes (-72.2%)",
      "texture props/decal.png (uastc): 700000 -> 210000 bytes (-70.0%)",
      "textures total: 884320 -> 261234 bytes (-70.5%)",
    ]);
    // The gate this report exists for: the total must actually be smaller.
    const total = lines.find((line) => line.startsWith("textures total"));
    expect(total).toBeDefined();
    const [before, after] = (total ?? "").match(/(\d+) -> (\d+)/u)?.slice(1, 3) ?? ["0", "0"];
    expect(Number(after)).toBeLessThan(Number(before));
  });

  it("should print nothing when no texture was compressed", () => {
    expect(formatTextureSizes([])).toEqual([]);
  });
});

describe("formatModelSizes", () => {
  it("should report fewer bytes and the geometry count after the model pass", () => {
    const rows: readonly IModelSizeRow[] = [
      {
        after: 9_120,
        before: 24_576,
        extensions: ["EXT_meshopt_compression", "KHR_mesh_quantization"],
        logicalPath: "characters/knight.glb",
        triangles: 4_096,
      },
    ];
    const lines = formatModelSizes(rows);

    expect(lines).toEqual([
      "model characters/knight.glb (EXT_meshopt_compression, KHR_mesh_quantization): 24576 -> 9120 bytes (-62.9%), 4096 triangle(s)",
      "models total: 24576 -> 9120 bytes (-62.9%)",
    ]);
    // The gate this report exists for: the total must actually be smaller.
    const total = lines.find((line) => line.startsWith("models total"));
    expect(total).toBeDefined();
    const [before, after] = (total ?? "").match(/(\d+) -> (\d+)/u)?.slice(1, 3) ?? ["0", "0"];
    expect(Number(after)).toBeLessThan(Number(before));
  });

  it("should print nothing when no model was optimized", () => {
    expect(formatModelSizes([])).toEqual([]);
  });

  it("should report the baked lightmap cost and atlas occupancy", () => {
    const lines = formatModelSizes([
      {
        after: 3_780,
        before: 2_336,
        lightmap: {
          atlasHeight: 68,
          atlasWidth: 76,
          bakeMs: 12.34,
          bytesAfter: 1_402,
          bytesBefore: 20_672,
          dilatedTexels: 48,
          occludedTexels: 12,
          validTexels: 320,
        },
        logicalPath: "static-light.glb",
      },
    ]);

    expect(lines[1]).toBe(
      "lightmap static-light.glb: atlas 76x68, 320 valid + 48 dilated texels, 12 occluded, 20672 -> 1402 bytes (-93.2%), bake 12.3 ms",
    );
  });
});

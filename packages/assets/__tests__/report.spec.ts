import { describe, expect, it } from "vitest";
import { formatModelSizes, formatSkippedCompression, formatTextureSizes } from "../src/report.js";
import type { IModelSizeRow, ISkippedCompressionRow, ITextureSizeRow } from "../src/report.js";

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

  it("should name the reason on a row whose bytes were retained rather than compressed", () => {
    const rows: readonly ITextureSizeRow[] = [
      { after: 51_234, before: 184_320, format: "etc1s", logicalPath: "rock.png" },
      {
        after: 512,
        before: 512,
        compressionSkipped: "block-size",
        format: undefined,
        logicalPath: "ui/decal.png",
      },
    ];

    expect(formatTextureSizes(rows)).toEqual([
      "texture rock.png (etc1s): 184320 -> 51234 bytes (-72.2%)",
      "texture ui/decal.png: 512 -> 512 bytes (-0.0%); compression skipped: block-size",
      "textures total: 184832 -> 51746 bytes (-72.0%)",
    ]);
  });
});

describe("formatModelSizes", () => {
  it("names each retained embedded image and its compression fallback", () => {
    const lines = formatModelSizes([
      {
        after: 100,
        before: 100,
        logicalPath: "prop.glb",
        embeddedTextures: {
          bytesAfter: 50,
          bytesBefore: 50,
          count: 2,
          gpuBytesAfter: 100,
          gpuBytesBefore: 100,
          resized: 0,
          skippedCompression: { decal: "block-size", tiny: "not-smaller" },
        },
      },
    ]);
    expect(lines).toContain("embedded texture prop.glb#decal: compression skipped: block-size");
    expect(lines).toContain("embedded texture prop.glb#tiny: compression skipped: not-smaller");
  });

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

describe("formatSkippedCompression", () => {
  it("names the decoder capability that a target skipped without blaming dedupe", () => {
    const rows: readonly ISkippedCompressionRow[] = [
      { bytes: 240, files: 2, kind: "model", reason: "platform" },
      { bytes: 120, files: 1, kind: "texture", reason: "platform" },
    ];
    const lines = formatSkippedCompression(rows);

    expect(lines[0]).toContain("meshopt");
    expect(lines[0]).toContain("KTX2");
    expect(lines[1]).toContain("KTX2");
    expect(lines.join("\n")).not.toContain("dedupe");
  });
});

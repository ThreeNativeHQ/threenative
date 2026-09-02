import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../test-support/temp-dir.js";
import {
  VFX_GALLERY_EFFECT_IDS,
  assertGalleryAssertionKinds,
  compareGalleryCaptures,
  measureGalleryTile,
  requiredPng,
  validateGalleryEvidence,
} from "../vfx-gallery-visual.js";

function image(alpha = 255, colour: readonly [number, number, number] = [255, 80, 32]): PNG {
  const png = new PNG({ height: 4, width: 4 });
  for (let offset = 0; offset < png.data.length; offset += 4) {
    png.data[offset] = colour[0];
    png.data[offset + 1] = colour[1];
    png.data[offset + 2] = colour[2];
    png.data[offset + 3] = alpha;
  }
  return png;
}

const region = { id: "fire", x: 0, y: 0, width: 4, height: 4 } as const;

describe("vfx gallery visual gate", () => {
  it("counts a populated tile only when visible pixels have alpha", () => {
    expect(measureGalleryTile(image(), region).occupiedPixels).toBe(16);
    expect(measureGalleryTile(image(0), region).occupiedPixels).toBe(0);
  });

  it("names the missing effect when the 46-id observation is incomplete", () => {
    const ids = VFX_GALLERY_EFFECT_IDS.filter((id) => id !== "godot-waterfall-mist");
    const metrics = VFX_GALLERY_EFFECT_IDS.map((id) => ({
      ...region,
      id,
      occupiedPixels: 1,
      occupiedRatio: 1 / 16,
    }));
    expect(() => validateGalleryEvidence(ids, metrics)).toThrow(
      "TN_VFX_GALLERY_MISSING_TILE:godot-waterfall-mist",
    );
  });

  it("fails closed for a zero-alpha tile", () => {
    const ids = [...VFX_GALLERY_EFFECT_IDS];
    const metrics = VFX_GALLERY_EFFECT_IDS.map((id) => ({
      ...region,
      id,
      occupiedPixels: id === "godot-portal-vortex" ? 0 : 1,
      occupiedRatio: id === "godot-portal-vortex" ? 0 : 1 / 16,
    }));
    expect(() => validateGalleryEvidence(ids, metrics)).toThrow(
      "TN_VFX_GALLERY_TILE_EMPTY:godot-portal-vortex",
    );
  });

  it("rejects a misspelled assertion kind", () => {
    expect(() => assertGalleryAssertionKinds(["frameDiff", "regoin"])).toThrow(
      "TN_VFX_GALLERY_ASSERTION_KIND:regoin",
    );
  });

  it("rejects a deleted stale capture and identical baseline/candidate images", async () => {
    const root = await makeTempDir("threenative-vfx-gallery-visual-");
    const deleted = join(root, "stale.png");
    try {
      await expect(() => requiredPng(deleted)).toThrow("TN_VFX_GALLERY_CAPTURE_MISSING");
      const same = image();
      expect(() => compareGalleryCaptures(same, same)).toThrow("TN_VFX_GALLERY_CAPTURE_UNCHANGED");
      await writeFile(deleted, PNG.sync.write(same));
      expect(requiredPng(deleted).width).toBe(4);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

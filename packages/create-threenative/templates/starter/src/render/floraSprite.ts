// Generated for you: one procedural leaf-cluster sprite, written straight
// into pixel data. Zero assets on disk — the foliage cards sample this
// texture. Pixel data, not a painted canvas: canvas-drawn images sample
// black under WebGPURenderer, and node has no document at all (the
// allocation-probe suite builds this scene headless).
import { DataTexture, RGBAFormat, UnsignedByteType } from "three";

function veinCover(x: number, y: number, size: number, center: number, vein: number): number {
  const angle = (vein / 2) * 0.5;
  const length = size * 0.42 * (1 - Math.abs(vein) * 0.14);
  const width = size * 0.13 * (1 - Math.abs(vein) * 0.18);
  // Rotate the pixel into the vein's frame: u across, v along.
  const px = x - center;
  const py = y - center + size * 0.04;
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const u = px * cos - py * sin;
  const v = px * sin + py * cos + length * 0.3;
  const ellipse = (u / width) ** 2 + (v / length) ** 2;
  if (ellipse >= 1) return 0;
  let cover = 1 - ellipse;
  // Vein cut line: dark groove from stem to tip.
  const groove = Math.abs(u - vein * size * 0.045 * (0.3 - v / size)) < size / 64;
  if (groove && v > -length * 0.7 && v < length * 0.7) cover *= 0.45;
  return cover;
}

/** Layered leaf-cluster along five veins. White: tint via material. */
export function createLeafSprite(size = 128): DataTexture {
  if (!Number.isInteger(size) || size <= 0)
    throw new Error("TN_FLORA_SPRITE_FAILED: size must be a positive integer.");
  const data = new Uint8Array(size * size * 4);
  const center = (size - 1) / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // Cluster of five vein ellipses fanning upward from the stem point.
      let cover = 0;
      for (let vein = -2; vein <= 2; vein += 1)
        cover = Math.max(cover, veinCover(x, y, size, center, vein));
      const index = (y * size + x) * 4;
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
      data[index + 3] = Math.round(Math.min(1, cover) * 255);
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  texture.needsUpdate = true;
  return texture;
}

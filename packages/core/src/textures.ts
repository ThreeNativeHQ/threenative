import { DataTexture, RGBAFormat, UnsignedByteType } from "three";

/**
 * A soft round sprite, built as pixel data rather than by painting a canvas.
 *
 * Canvas-drawn images sample black under `WebGPURenderer` — a documented trap that cost a shipped
 * game real debugging time — so sprite images are written straight into pixel data. A radial alpha
 * falloff is also the whole difference between a puff and a rectangle: a flat quad reads as a grey
 * box, the same quad with this alpha reads as smoke.
 *
 * @param size edge length in pixels
 * @param hardness 0 fades from the very centre, 1 keeps a solid core out to the rim
 */
export function softCircleDataTexture(size = 64, hardness = 0.25): DataTexture {
  if (!Number.isInteger(size) || size <= 0)
    throw new Error("softCircleDataTexture size must be a positive integer.");
  if (!Number.isFinite(hardness) || hardness < 0 || hardness > 1)
    throw new Error("softCircleDataTexture hardness must be between 0 and 1.");
  const data = new Uint8Array(size * size * 4);
  const centre = (size - 1) / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x - centre) / centre;
      const dy = (y - centre) / centre;
      const distance = Math.sqrt(dx * dx + dy * dy);
      // 1 at the centre, 0 at the rim, with a flat core when hardness is raised.
      const falloff =
        distance >= 1 ? 0 : hardness >= 1 ? 1 : Math.min(1, (1 - distance) / (1 - hardness)) ** 1.6;
      const index = (y * size + x) * 4;
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
      data[index + 3] = Math.round(falloff * 255);
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  texture.needsUpdate = true;
  return texture;
}

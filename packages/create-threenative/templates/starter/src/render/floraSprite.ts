// Generated for you: one procedural leaf-cluster sprite, drawn once on a
// canvas. Zero assets on disk — the foliage cards sample this texture.
import { CanvasTexture } from "three";

/** Layered ellipses along veins, with cut vein lines. White: tint via material. */
export function createLeafSprite(size = 128): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("TN_FLORA_SPRITE_FAILED: 2d context unavailable.");
  const center = size / 2;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "#ffffff";
  for (let vein = -2; vein <= 2; vein += 1) {
    const angle = (vein / 2) * 0.5;
    const length = size * 0.42 * (1 - Math.abs(vein) * 0.14);
    const width = size * 0.13 * (1 - Math.abs(vein) * 0.18);
    ctx.save();
    ctx.translate(center, center);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.ellipse(0, -length * 0.3, width, length, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.globalCompositeOperation = "destination-out";
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = Math.max(1, size / 64);
  for (let vein = -2; vein <= 2; vein += 1) {
    ctx.beginPath();
    ctx.moveTo(center, center + size * 0.3);
    ctx.lineTo(center + vein * size * 0.09, center - size * 0.38);
    ctx.stroke();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = "srgb";
  return texture;
}

import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from "three";

/**
 * Every texture here is drawn at boot on a 2D canvas. The first playable screen therefore needs
 * no asset server, no account and no network.
 */
function paint(size: number, draw: (context: CanvasRenderingContext2D) => void): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("2D canvas context is unavailable; cannot build textures.");
  draw(context);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Planked crate face with the diagonal brace from the reference. */
export function crateTexture(): Texture {
  return paint(256, (context) => {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, 256, 256);

    context.strokeStyle = "rgba(0, 0, 0, 0.30)";
    context.lineWidth = 5;
    for (let line = 1; line < 4; line += 1) {
      context.beginPath();
      context.moveTo(0, line * 64);
      context.lineTo(256, line * 64);
      context.stroke();
    }

    context.strokeStyle = "rgba(0, 0, 0, 0.24)";
    context.lineWidth = 22;
    context.beginPath();
    context.moveTo(26, 26);
    context.lineTo(230, 230);
    context.moveTo(230, 26);
    context.lineTo(26, 230);
    context.stroke();

    context.strokeStyle = "rgba(255, 255, 255, 0.35)";
    context.lineWidth = 20;
    context.strokeRect(10, 10, 236, 236);
    context.strokeStyle = "rgba(0, 0, 0, 0.38)";
    context.lineWidth = 8;
    context.strokeRect(4, 4, 248, 248);
  });
}

/** Large flagstones for the floor. */
export function floorTexture(repeat: number): Texture {
  const texture = paint(256, (context) => {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, 256, 256);
    context.strokeStyle = "rgba(0, 0, 0, 0.45)";
    context.lineWidth = 6;
    context.strokeRect(0, 0, 256, 256);
    context.strokeStyle = "rgba(255, 255, 255, 0.10)";
    context.lineWidth = 3;
    context.strokeRect(10, 10, 236, 236);
  });
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  return texture;
}

/** Concentric rings for the destination pad. */
export function goalTexture(): Texture {
  return paint(256, (context) => {
    context.fillStyle = "#06232c";
    context.fillRect(0, 0, 256, 256);
    context.strokeStyle = "#7ff0ff";
    for (const [inset, width] of [
      [26, 10],
      [58, 7],
      [90, 5],
    ] as const) {
      context.lineWidth = width;
      context.beginPath();
      context.moveTo(128, inset);
      context.lineTo(256 - inset, 128);
      context.lineTo(128, 256 - inset);
      context.lineTo(inset, 128);
      context.closePath();
      context.stroke();
    }
    context.fillStyle = "#bdf6ff";
    context.beginPath();
    context.moveTo(128, 108);
    context.lineTo(148, 128);
    context.lineTo(128, 148);
    context.lineTo(108, 128);
    context.closePath();
    context.fill();
  });
}

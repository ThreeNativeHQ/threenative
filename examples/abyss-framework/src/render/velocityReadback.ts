/** Summarize actual RGBA velocity pixels: the static sub-draw occupies the left half. */
export function summarizeVelocityPixels(data: Float32Array, width: number, height: number) {
  if (!Number.isInteger(width) || width < 2 || !Number.isInteger(height) || height < 1)
    throw new Error("Velocity readback requires positive image dimensions.");
  if (data.length !== width * height * 4)
    throw new Error("Velocity readback must contain one RGBA value per pixel.");
  let staticMax = 0;
  let movingMax = 0;
  let movingPixels = 0;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const x = data[pixel * 4];
    const y = data[pixel * 4 + 1];
    if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y))
      throw new Error("Velocity readback contains non-finite motion.");
    const speed = Math.hypot(x, y);
    if (pixel % width < width / 2) staticMax = Math.max(staticMax, speed);
    else {
      movingMax = Math.max(movingMax, speed);
      if (speed > 0.001) movingPixels += 1;
    }
  }
  return { staticMax, movingMax, movingPixels };
}

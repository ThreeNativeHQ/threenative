import type { Texture } from "three";
import type { INeuralGPUBridge } from "./gpu-contract.js";

function half(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 31;
  const fraction = bits & 1023;
  if (exponent === 31) return Number.NaN;
  return (
    sign * (exponent === 0 ? fraction * 2 ** -24 : (1 + fraction / 1024) * 2 ** (exponent - 15))
  );
}

/** A GPU result must pass these assertions; a submitted job alone is not a rendering proof. */
export function verifyFixturePixels(
  original: Uint16Array,
  enhanced: Uint16Array,
  expectedBackground: readonly [number, number, number],
) {
  if (original.length === 0 || original.length % 4 !== 0 || enhanced.length !== original.length) {
    throw new Error("NEURAL_PROOF_LENGTH: missing or truncated image");
  }
  for (let channel = 0; channel < 3; channel += 1) {
    const actual = half(original[channel] ?? 0);
    const expected = expectedBackground[channel];
    if (expected === undefined || !Number.isFinite(actual) || Math.abs(actual - expected) > 0.01) {
      throw new Error("NEURAL_PROOF_SOURCE: did not capture the current HDR background");
    }
  }
  let changedPixels = 0;
  let hdrPixels = 0;
  for (let p = 0; p < original.length; p += 4) {
    if (
      enhanced[p] !== original[p + 2] ||
      enhanced[p + 1] !== original[p + 1] ||
      enhanced[p + 2] !== original[p] ||
      enhanced[p + 3] !== original[p + 3]
    ) {
      throw new Error("NEURAL_PROOF_CHANNEL: compute output is not the expected RGBA transform");
    }
    if (original[p] !== original[p + 2]) changedPixels += 1;
    if (
      Math.max(half(original[p] ?? 0), half(original[p + 1] ?? 0), half(original[p + 2] ?? 0)) > 1
    )
      hdrPixels += 1;
  }
  if (changedPixels === 0 || hdrPixels === 0)
    throw new Error("NEURAL_PROOF_SIGNAL: blank or uninformative fixture");
  return Object.freeze({ pixels: original.length / 4, changedPixels, hdrPixels });
}

/** Diagnostic-only bounded readback; never called by the rendering or neural adapter path. */
export async function readFixtureProof(
  bridge: INeuralGPUBridge,
  textures: { readonly original: Texture; readonly enhanced: Texture },
  width: number,
  height: number,
  expectedBackground: readonly [number, number, number],
) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 512 ||
    height > 512
  ) {
    throw new Error("NEURAL_PROOF_SIZE: diagnostic capped at 512 pixels per axis");
  }
  const rowBytes = Math.ceil((width * 8) / 256) * 256;
  const imageBytes = rowBytes * height;
  const staging = bridge.device.createBuffer({
    label: "neural diagnostic readback",
    size: imageBytes * 2,
    usage: 9,
  });
  let retired: Promise<void> = Promise.resolve();
  try {
    const job = bridge.submit((encoder) => {
      for (const [index, texture] of [textures.original, textures.enhanced].entries()) {
        const gpu = bridge.texture(texture, { width, height, format: "rgba16float", usage: 1 });
        encoder.copyTextureToBuffer(
          { texture: gpu },
          {
            buffer: staging,
            offset: index * imageBytes,
            bytesPerRow: rowBytes,
            rowsPerImage: height,
          },
          { width, height, depthOrArrayLayers: 1 },
        );
      }
    });
    retired = job.retired;
    await job.completed;
    await staging.mapAsync(1);
    const mapped = new Uint16Array(staging.getMappedRange());
    const unpack = (offset: number) => {
      const image = new Uint16Array(width * height * 4);
      for (let y = 0; y < height; y += 1)
        image.set(
          mapped.subarray(offset + (y * rowBytes) / 2, offset + (y * rowBytes) / 2 + width * 4),
          y * width * 4,
        );
      return image;
    };
    return verifyFixturePixels(unpack(0), unpack(imageBytes / 2), expectedBackground);
  } finally {
    await retired;
    if (staging.mapState === "mapped") staging.unmap();
    staging.destroy();
  }
}

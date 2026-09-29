import type { INeuralComputeProvider } from "./gpu-contract.js";
import { ImageKernel, validateImagePair } from "./image-kernel.js";

/**
 * The fixture's grade, in scene-linear HDR. Deterministic, order-independent per pixel, and
 * simple enough to re-derive exactly on the CPU — which is what makes it a *proof* rather than
 * an effect: a saturation lift around luma, then a contrast curve pivoted on mid grey.
 *
 * A channel swap was the first choice here because it is unmissably wrong when it is wrong. It
 * also recolours literally every pixel, so the Before/After pair read as a bug rather than as the
 * pipeline working. This grades instead: the frame keeps its colours, gains saturation and
 * contrast, and a broken transport still shows up — a dropped pass, a stale capture or a
 * mismatched device all fail the CPU re-derivation in `fixture-proof.ts`.
 */
export const FIXTURE_LUMA = [0.2126, 0.7152, 0.0722] as const;
export const FIXTURE_SATURATION = 1.45;
export const FIXTURE_CONTRAST = 1.18;
export const FIXTURE_PIVOT = 0.18;

const SHADER = /* wgsl */ `
@group(0) @binding(0) var original: texture_2d<f32>;
@group(0) @binding(1) var enhanced: texture_storage_2d<rgba16float, write>;

const LUMA = vec3<f32>(0.2126, 0.7152, 0.0722);
const SATURATION = 1.45;
const CONTRAST = 1.18;
const PIVOT = 0.18;

@compute @workgroup_size(8, 8)
fn fixture_grade(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = textureDimensions(enhanced);
  if (any(id.xy >= size)) { return; }
  let color = textureLoad(original, vec2<i32>(id.xy), 0);
  let luma = dot(color.rgb, LUMA);
  let saturated = mix(vec3<f32>(luma), color.rgb, SATURATION);
  let graded = (saturated - vec3<f32>(PIVOT)) * CONTRAST + vec3<f32>(PIVOT);
  textureStore(enhanced, vec2<i32>(id.xy), vec4<f32>(max(graded, vec3<f32>(0.0)), color.a));
}`;

/** An actual deterministic WGSL transform. It is deliberately NOT a neural model. */
export function createFixtureProvider(
  device: GPUDevice,
  width: number,
  height: number,
): INeuralComputeProvider {
  for (const value of [width, height]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 512)
      throw new Error("NEURAL_DIMENSION: invalid fixture size");
  }
  const kernel = new ImageKernel(device, SHADER, "fixture_grade");
  return {
    device,
    width,
    height,
    id: "integration-fixture/grade",
    kind: "fixture",
    estimatedBytes: 0,
    encode(encoder, { original, enhanced }) {
      validateImagePair(original, enhanced, width, height);
      kernel.encode(
        encoder,
        [
          { binding: 0, resource: original.createView() },
          { binding: 1, resource: enhanced.createView() },
        ],
        width,
        height,
      );
    },
    dispose() {
      kernel.dispose();
    },
  };
}

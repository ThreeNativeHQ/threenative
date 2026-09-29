import type { INeuralComputeProvider } from "./gpu-contract.js";
import { ImageKernel, validateImagePair } from "./image-kernel.js";

const SHADER = /* wgsl */ `
@group(0) @binding(0) var original: texture_2d<f32>;
@group(0) @binding(1) var enhanced: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8)
fn fixture_channel_swap(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = textureDimensions(enhanced);
  if (any(id.xy >= size)) { return; }
  let color = textureLoad(original, vec2<i32>(id.xy), 0);
  textureStore(enhanced, vec2<i32>(id.xy), vec4<f32>(color.b, color.g, color.r, color.a));
}`;

/** An actual deterministic WGSL transform. It is deliberately NOT a neural model. */
export function createFixtureProvider(device: GPUDevice, width: number, height: number): INeuralComputeProvider {
  for (const value of [width, height]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 512) throw new Error("NEURAL_DIMENSION: invalid fixture size");
  }
  const kernel = new ImageKernel(device, SHADER, "fixture_channel_swap");
  return {
    device, width, height, id: "integration-fixture/channel-swap", kind: "fixture", estimatedBytes: 0,
    encode(encoder, { original, enhanced }) {
      validateImagePair(original, enhanced, width, height);
      kernel.encode(encoder, [
        { binding: 0, resource: original.createView() },
        { binding: 1, resource: enhanced.createView() },
      ], width, height);
    },
    dispose() { kernel.dispose(); },
  };
}

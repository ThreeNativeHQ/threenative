import { HalfFloatType, LinearSRGBColorSpace } from "three";
import { select, texture, uniform, uv } from "three/tsl";
import { type Node, type PassNode, StorageTexture } from "three/webgpu";
import type { NeuralFrameResetReason } from "./frame-gate.js";
import { requireSynchronous, type INeuralComputeProvider, type INeuralGPUBridge } from "./gpu-contract.js";
import { ImageKernel } from "./image-kernel.js";
import { afterRenderedPass } from "./render-hook.js";
import { NeuralSnapshotDriver } from "./snapshot-driver.js";

const CAPTURE = /* wgsl */ `
@group(0) @binding(0) var world: texture_2d<f32>;
@group(0) @binding(1) var linear_sampler: sampler;
@group(0) @binding(2) var captured: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8)
fn capture_linear_hdr(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = textureDimensions(captured);
  if (any(id.xy >= size)) { return; }
  let coord = (vec2<f32>(id.xy) + vec2<f32>(0.5)) / vec2<f32>(size);
  textureStore(captured, vec2<i32>(id.xy), textureSampleLevel(world, linear_sampler, coord, 0.0));
}`;

export interface INeuralCaptureOptions {
  readonly worldPass: PassNode;
  readonly bridge: INeuralGPUBridge;
  readonly provider: INeuralComputeProvider;
  readonly maxBytes: number;
  /** Reapply the EXISTING chain; needed to remove bindings before destroying textures. */
  readonly rebuildGraph: () => void;
  /** First by default. The stage must receive the unmodified world-pass output. */
  readonly before?: string;
}

/**
 * Attach to the game's existing PassNode and RenderChain; no new composer, second device,
 * transform history or CPU image transport. Calling this function explicitly opts in.
 */
export function attachNeuralCapture(options: INeuralCaptureOptions) {
  const { worldPass, bridge, provider } = options;
  const driver = new NeuralSnapshotDriver(bridge, provider, options.maxBytes);
  const { width, height } = provider;
  const makeTexture = (name: string) => {
    const result = new StorageTexture(width, height);
    result.type = HalfFloatType;
    result.generateMipmaps = false;
    // `mipmapsAutoUpdate` exists on three's StorageTexture at runtime and is absent from
    // `@types/three`; core's atmosphere LUTs narrow it the same way.
    (result as StorageTexture & { mipmapsAutoUpdate: boolean }).mipmapsAutoUpdate = false;
    result.flipY = false;
    result.colorSpace = LinearSRGBColorSpace;
    result.name = name;
    return result;
  };
  const original = makeTexture("neural frozen original");
  const enhanced = makeTexture("neural frozen result");
  const ready = uniform(0);
  const divider = uniform(0.5);
  const view = uniform(0); // split=0, original=1, enhanced=2
  const captureKernel = new ImageKernel(bridge.device, CAPTURE, "capture_linear_hdr");
  let sampler: GPUSampler | undefined;
  let frameId = 0;
  let lastWorldSize: string | undefined;
  let installed = false;
  let closed = false;
  let disposal: Promise<void> | undefined;
  driver.enable();

  const detach = afterRenderedPass(worldPass, () => {
    frameId += 1;
    if (!installed || closed) return;
    const sourceWidth = worldPass.renderTarget.width;
    const sourceHeight = worldPass.renderTarget.height;
    const size = `${sourceWidth}x${sourceHeight}`;
    if (lastWorldSize !== undefined && size !== lastWorldSize) driver.reset("resize");
    lastWorldSize = size;
    driver.afterWorld(frameId, (encoder) => {
      // The original updateBefore already queued this frame's world rendering on the same device.
      const source = bridge.texture(worldPass.getTexture("output"), {
        width: sourceWidth, height: sourceHeight, format: "rgba16float", usage: 4,
      });
      const captured = bridge.texture(original, { width, height, format: "rgba16float", usage: 12, initialize: true });
      const output = bridge.texture(enhanced, { width, height, format: "rgba16float", usage: 12, initialize: true });
      sampler ??= bridge.device.createSampler({ minFilter: "linear", magFilter: "linear" });
      captureKernel.encode(encoder, [
        { binding: 0, resource: source.createView() },
        { binding: 1, resource: sampler },
        { binding: 2, resource: captured.createView() },
      ], width, height);
      return { original: captured, enhanced: output };
    });
    ready.value = driver.state.frozen ? 1 : 0;
  });

  const stage = {
    name: "neuralSnapshot",
    before: options.before ?? "probeVolume",
    requiresVelocity: false,
    available: () => closed ? "neural:disabled" : true,
    build(input: unknown) {
      if (input !== worldPass.getTextureNode("output")) {
        throw new Error("NEURAL_ORDER: insert before other effects; refusing to discard an earlier stage's output");
      }
      const left = texture(original);
      const right = texture(enhanced);
      const split = select(uv().x.lessThan(divider), left, right);
      const frozen = select(view.equal(1), left, select(view.equal(2), right, split));
      installed = true;
      return select(ready.greaterThan(0), frozen, input as Node);
    },
    // RenderChain calls this on every rebuild: deactivate only, never destroy shared resources here.
    dispose() { installed = false; ready.value = 0; driver.reset("scale-change"); },
  };

  return {
    stage,
    textures: Object.freeze({ original, enhanced }),
    get state() {
      const state = driver.state;
      return Object.freeze({ ...state, gpuMs: undefined,
        resultAgeFrames: state.frameId === undefined ? undefined : frameId - state.frameId,
        resampling: "bilinear", outputDomain: "scene-linear-hdr" });
    },
    get settled() { return driver.settled; },
    capture() { ready.value = 0; driver.request(); },
    reset(reason: NeuralFrameResetReason) { ready.value = 0; driver.reset(reason); },
    setDivider(value: number) {
      if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("NEURAL_DIVIDER: expected [0, 1]");
      divider.value = value;
    },
    setView(value: "split" | "original" | "enhanced") {
      if (!["split", "original", "enhanced"].includes(value)) throw new Error("NEURAL_VIEW: unsupported view");
      view.value = value === "original" ? 1 : value === "enhanced" ? 2 : 0;
    },
    dispose(): Promise<void> {
      if (disposal !== undefined) return disposal;
      closed = true; installed = false; ready.value = 0; detach();
      const stopped = driver.stop();
      try { requireSynchronous(options.rebuildGraph(), "render-chain detachment"); }
      catch (error) {
        // Retain allocations if the game could not remove their display bindings; a retry is safe.
        return Promise.reject(error);
      }
      disposal = stopped.then(() => bridge.retire()).then(() => {
        const errors: unknown[] = [];
        for (const release of [() => captureKernel.dispose(), () => provider.dispose(),
          () => original.dispose(), () => enhanced.dispose()]) {
          try { release(); } catch (error) { errors.push(error); }
        }
        sampler = undefined;
        if (errors.length > 0) throw new AggregateError(errors, "NEURAL_CLEANUP: allocation cleanup failed");
      });
      return disposal;
    },
  };
}

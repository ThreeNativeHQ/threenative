import { requireSynchronous, type INeuralComputeProvider } from "./gpu-contract.js";
import { ImageKernel, validateImagePair } from "./image-kernel.js";
import { OPEN_DLSS_COMPOSE, OPEN_DLSS_INPUT } from "./opendlss-shaders.js";

export const OPEN_DLSS_NR_REVISION = "9d08f4184bbcb9d858e2fb7a7834ec0837a9d2f1";

/** Prepared by trusted, pinned application code, with authorized and verified model data. */
export interface IPreparedOpenDLSSNetwork {
  readonly device: GPUDevice;
  readonly geometry: {
    readonly validWidth: number;
    readonly validHeight: number;
    readonly fullWidth: number;
    readonly fullHeight: number;
    readonly fullRows: number;
  };
  readonly features: { readonly buffer: GPUBuffer };
  readonly graph: { readonly head: { readonly buffer: GPUBuffer; readonly rows: number } };
  readonly recorder: { encode(encoder: GPUCommandEncoder): void };
  readonly tensors: { readonly total: number };
  readonly model: { readonly bytesUploaded: number };
}

export interface IOpenDLSSSnapshotConditioning {
  readonly paperWhite?: number;
  readonly localTone?: number;
  readonly localStructure?: number;
  readonly skinStructure?: number;
  readonly autoMask?: boolean;
  readonly intensity?: number;
  readonly colorStrength?: number;
  readonly seed?: number;
}

export interface IOpenDLSSSnapshotOptions {
  /** Borrowed exclusively for this adapter's lifetime. Do not call network.run() concurrently. */
  readonly network: IPreparedOpenDLSSNetwork;
  /** Caller-supplied source identity, NOT a signature/authenticity check. */
  readonly sourceRevision: typeof OPEN_DLSS_NR_REVISION;
  /** Trusted whole-network peak estimate, including repacking/recorder allocations. */
  readonly peakBytes: number;
  readonly conditioning?: IOpenDLSSSnapshotConditioning;
}

// Field rule from pinned geometry.js, Copyright (c) 2026 maan, MIT; see LICENSE.OpenDLSS-NR.
function paddedGeometry(validWidth: number, validHeight: number): readonly [number, number] {
  const up = (n: number, a: number) => Math.ceil(n / a) * a;
  const alignment = (valid: number) => {
    let reductions = 0;
    let size = valid;
    for (let level = 0; level < 6; level += 1) {
      const half = up(Math.floor((size + 1) / 2), 4);
      if (half < size) reductions += 1;
      if (level === 0 && half % 8 !== 0) reductions += 1;
      size = half;
    }
    return 1 << reductions;
  };
  const ax = alignment(validWidth);
  const ay = alignment(validHeight);
  let width = Math.max(320, up(validWidth, ax));
  const height = Math.max(320, up(validHeight, ay));
  if (width % (4 * ax) === 0 && height % (4 * ay) === 0) width += ax;
  return [width, height];
}

function conditioningBytes(width: number, height: number, fullWidth: number, fullHeight: number,
  options: IOpenDLSSSnapshotConditioning): ArrayBuffer {
  const keys = ["paperWhite", "localTone", "localStructure", "skinStructure", "autoMask", "intensity", "colorStrength", "seed"];
  if (options === null || typeof options !== "object" || Array.isArray(options) ||
      Object.keys(options).some((key) => !keys.includes(key))) {
    throw new Error("NEURAL_CONDITIONING: only snapshot controls are supported; temporal and style are unavailable");
  }
  const value = (v: number | undefined, fallback: number, min: number, max: number) => {
    const n = v ?? fallback;
    if (!Number.isFinite(n) || n < min || n > max) throw new Error("NEURAL_CONDITIONING: value outside supported range");
    return n;
  };
  const result = new ArrayBuffer(64);
  const words = new Uint32Array(result);
  const floats = new Float32Array(result);
  words.set([width, height, fullWidth, fullHeight]);
  floats[4] = value(options.paperWhite, 1, 0.05, 100);
  floats[5] = value(options.localTone, 1, 0, 1);
  floats[6] = value(options.localStructure, 1, 0, 1);
  floats[7] = value(options.skinStructure, -1, -1, 1);
  if (options.autoMask !== undefined && typeof options.autoMask !== "boolean") throw new Error("NEURAL_CONDITIONING: autoMask must be boolean");
  floats[8] = options.autoMask === true ? 1 : -1;
  floats[9] = value(options.intensity, 1, 0, 1);
  floats[10] = value(options.colorStrength, 1, 0, 1);
  const seed = value(options.seed, 0, 0, 0xffffffff);
  if (!Number.isInteger(seed)) throw new Error("NEURAL_CONDITIONING: seed must be a uint32");
  words[12] = seed;
  return result;
}

/**
 * Real GPU adapter: scene texture -> sixteen feature lanes -> recorder.encode -> HDR texture.
 * Does not load weights, run the upstream CPU transport, acquire a device, or call Network.destroy().
 */
export function createOpenDLSSNRProvider(device: GPUDevice, options: IOpenDLSSSnapshotOptions): INeuralComputeProvider {
  const { network } = options;
  if (options.sourceRevision !== OPEN_DLSS_NR_REVISION) throw new Error("NEURAL_REVISION: unqualified source revision");
  if (network.device !== device) throw new Error("NEURAL_DEVICE: network must use the renderer's device");
  if (!(device.limits.maxComputeWorkgroupStorageSize >= 32768)) {
    throw new Error("NEURAL_DEVICE_LIMIT: maxComputeWorkgroupStorageSize requires 32768 bytes");
  }
  const { validWidth: width, validHeight: height, fullWidth, fullHeight, fullRows } = network.geometry;
  for (const n of [width, height]) {
    if (!Number.isSafeInteger(n) || n < 33 || n > 512) throw new Error("NEURAL_GEOMETRY: invalid snapshot dimensions");
  }
  const [expectedWidth, expectedHeight] = paddedGeometry(width, height);
  if (fullWidth !== expectedWidth || fullHeight !== expectedHeight || fullRows !== fullWidth * fullHeight ||
      network.graph.head.rows !== fullRows || fullWidth > 2 * width - 1 || fullHeight > 2 * height - 1 ||
      Math.ceil(fullWidth / 2 / 4) * 4 % 8 !== 0 || Math.ceil(fullHeight / 2 / 4) * 4 % 8 !== 0) {
    throw new Error("NEURAL_GEOMETRY: padded graph or single-reflection boundary is unsupported");
  }
  for (const [buffer, bytes] of [[network.features.buffer, fullRows * 64], [network.graph.head.buffer, fullRows * 16]] as const) {
    if (buffer.size < bytes || (buffer.usage & 128) !== 128 || buffer.mapState !== "unmapped" ||
        !(bytes <= device.limits.maxStorageBufferBindingSize)) {
      throw new Error("NEURAL_BUFFER: truncated, mapped, non-storage or over-limit tensor");
    }
  }
  const lowerBound = network.tensors.total + network.model.bytesUploaded;
  if (!Number.isSafeInteger(network.tensors.total) || network.tensors.total < fullRows * 80 ||
      !Number.isSafeInteger(network.model.bytesUploaded) || network.model.bytesUploaded < 1 ||
      !Number.isSafeInteger(options.peakBytes) || options.peakBytes < lowerBound ||
      !Number.isSafeInteger(options.peakBytes + 64)) {
    throw new Error("NEURAL_MEMORY: a conservative whole-network peak estimate is required");
  }
  const parameters = conditioningBytes(width, height, fullWidth, fullHeight, options.conditioning ?? {});
  const input = new ImageKernel(device, OPEN_DLSS_INPUT, "input_features");
  const compose = new ImageKernel(device, OPEN_DLSS_COMPOSE, "compose_hdr");
  let uniform: GPUBuffer | undefined;
  let closed = false;
  return {
    device, width, height, id: `opendlss-nr-webgpu@${OPEN_DLSS_NR_REVISION}`, kind: "neural",
    estimatedBytes: options.peakBytes + 64,
    encode(encoder, { original, enhanced }) {
      if (closed) throw new Error("NEURAL_CLOSED: adapter disposed");
      validateImagePair(original, enhanced, width, height);
      if (uniform === undefined) {
        // GPUBufferUsage.UNIFORM | COPY_DST. No global GPU access at module-import time.
        uniform = device.createBuffer({ label: "neural snapshot parameters", size: 64, usage: 0x48 });
        device.queue.writeBuffer(uniform, 0, parameters);
      }
      input.encode(encoder, [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 1, resource: original.createView() },
        { binding: 2, resource: { buffer: network.features.buffer, size: fullRows * 64 } },
      ], fullWidth, fullHeight);
      requireSynchronous(network.recorder.encode(encoder), "network recording");
      compose.encode(encoder, [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 1, resource: original.createView() },
        { binding: 2, resource: { buffer: network.graph.head.buffer, size: fullRows * 16 } },
        { binding: 3, resource: enhanced.createView() },
      ], width, height);
    },
    dispose() {
      if (closed) return;
      closed = true;
      uniform?.destroy(); uniform = undefined;
      input.dispose(); compose.dispose();
      // The prepared graph, tensors, model and renderer device remain caller-owned.
    },
  };
}

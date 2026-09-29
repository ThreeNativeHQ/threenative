import type { Texture } from "three";

/** Structural renderer seam. Supply createWebGPUInterop(ctx.renderer) from scene setup. */
export interface INeuralGPUBridge {
  readonly device: GPUDevice;
  texture(texture: Texture, request: {
    readonly width: number;
    readonly height: number;
    readonly format: GPUTextureFormat;
    readonly usage: GPUTextureUsageFlags;
    readonly initialize?: boolean;
  }): GPUTexture;
  submit(encode: (encoder: GPUCommandEncoder) => void): {
    readonly completed: Promise<void>;
    readonly retired: Promise<void>;
  };
  retire(): Promise<void>;
}

export interface INeuralCaptureTextures {
  readonly original: GPUTexture;
  readonly enhanced: GPUTexture;
}

/** Both textures contain scene-linear HDR rgba16float. No HUD or output transfer is included. */
export interface INeuralComputeProvider {
  readonly device: GPUDevice;
  readonly width: number;
  readonly height: number;
  readonly id: string;
  readonly kind: "fixture" | "neural";
  /** Provider working-set estimate, excluding the capture pair (16 bytes/pixel). */
  readonly estimatedBytes: number;
  encode(encoder: GPUCommandEncoder, textures: INeuralCaptureTextures): void;
  /** Called only after retirement. Never destroys the renderer device or a borrowed network. */
  dispose(): void;
}

/** GPU command recording and graph detachment must finish before the caller submits/retires. */
export function requireSynchronous(result: unknown, operation: string): void {
  if (result !== null && result !== undefined &&
      typeof (result as PromiseLike<unknown>).then === "function") {
    void Promise.resolve(result).catch(() => {});
    throw new Error(`NEURAL_SYNCHRONOUS: ${operation} must finish synchronously`);
  }
}

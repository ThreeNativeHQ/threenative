import { REVISION, type Texture } from "three";

/** The small, version-qualified raw-resource seam; it owns no device or appearance. */
export interface IWebGPUTextureRequest {
  readonly width: number;
  readonly height: number;
  readonly format: GPUTextureFormat;
  readonly usage: GPUTextureUsageFlags;
  /** Only for a caller-owned texture, never for an unrendered source pass. */
  readonly initialize?: boolean;
}

export interface IWebGPUSubmission {
  /** Success includes validation and queue completion. Rejection is NOT a retirement fence. */
  readonly completed: Promise<void>;
  /** Fulfills only after queue completion or confirmed device loss. */
  readonly retired: Promise<void>;
}

export interface IWebGPUInterop {
  /** Borrowed. A provider must never destroy it or submit outside the supplied encoder. */
  readonly device: GPUDevice;
  texture(texture: Texture, request: IWebGPUTextureRequest): GPUTexture;
  submit(encode: (encoder: GPUCommandEncoder) => void): IWebGPUSubmission;
  /** Includes graphics submitted after the most recent compute job, such as composition. */
  retire(): Promise<void>;
}

interface IThreeWebGPUBackend {
  readonly isWebGPUBackend?: boolean;
  readonly device?: GPUDevice | null;
  get(texture: Texture): { readonly texture?: GPUTexture };
}

interface IThreeWebGPURenderer {
  readonly backend?: IThreeWebGPUBackend;
  initTexture?(texture: Texture): void;
}

/**
 * Borrow the initialized renderer's device and textures for an opt-in external compute pass.
 * The r185 backend resource-map dependency stays here, never in generated game rendering code.
 * Recreate this seam after renderer-level device recovery; cross-device reuse fails closed.
 */
export function createWebGPUInterop(renderer: {
  readonly kind: string;
  readonly raw: unknown;
}): IWebGPUInterop {
  if (renderer.kind !== "webgpu") throw new Error("TN_WEBGPU_REQUIRED: WebGPU renderer required");
  if (REVISION !== "185") throw new Error(`TN_WEBGPU_REVISION: expected 185, received ${REVISION}`);
  const raw = renderer.raw as IThreeWebGPURenderer | undefined;
  const backend = raw?.backend;
  const device = backend?.device;
  if (
    backend?.isWebGPUBackend !== true || typeof backend.get !== "function" ||
    device == null || typeof device.createCommandEncoder !== "function" ||
    typeof device.queue?.onSubmittedWorkDone !== "function" ||
    typeof device.pushErrorScope !== "function" || typeof device.popErrorScope !== "function" ||
    typeof device.lost?.then !== "function"
  ) throw new Error("TN_WEBGPU_BACKEND: initialized r185 WebGPU backend required");

  const queue = device.queue;
  let lost = false;
  const lossListeners = new Set<() => void>();
  void device.lost.then(() => {
    lost = true;
    for (const notify of lossListeners) notify();
    lossListeners.clear();
  });
  // Remove each short-lived observer after its job, rather than accumulating promise reactions
  // on device.lost for the lifetime of a renderer that may take many snapshots.
  function watchLoss(): { promise: Promise<void>; release: () => void } {
    let notify!: () => void;
    const promise = new Promise<void>((resolve) => { notify = resolve; });
    if (lost) notify();
    else lossListeners.add(notify);
    return { promise, release: () => { lossListeners.delete(notify); } };
  }
  function assertCurrent(): void {
    if (lost || raw?.backend !== backend || backend?.device !== device) {
      throw new Error("TN_WEBGPU_LOST: renderer device changed or was lost");
    }
  }
  function fence(): { done: Promise<void>; retired: Promise<void> } {
    let done: Promise<void>;
    try { done = Promise.resolve(queue.onSubmittedWorkDone()); }
    catch (error) { done = Promise.reject(error); }
    // An unexpected rejected fence is NOT evidence that allocations can be destroyed.
    const watch = watchLoss();
    const retired = Promise.race([done.catch(() => watch.promise), watch.promise]).finally(watch.release);
    return { done, retired };
  }

  return {
    device,
    texture(texture, request) {
      assertCurrent();
      if (!Number.isSafeInteger(request.width) || request.width < 1 ||
          !Number.isSafeInteger(request.height) || request.height < 1 ||
          !Number.isSafeInteger(request.usage) || request.usage < 1 || request.usage > 31) {
        throw new Error("TN_WEBGPU_TEXTURE: invalid requested dimensions or usage");
      }
      if (request.initialize === true) {
        if (typeof raw?.initTexture !== "function") throw new Error("TN_WEBGPU_TEXTURE: initTexture unavailable");
        raw.initTexture(texture);
      }
      const gpu = backend.get(texture).texture;
      if (gpu === undefined || gpu.width !== request.width || gpu.height !== request.height ||
          gpu.depthOrArrayLayers !== 1 || gpu.sampleCount !== 1 || gpu.dimension !== "2d" ||
          gpu.format !== request.format || (gpu.usage & request.usage) !== request.usage) {
        throw new Error("TN_WEBGPU_TEXTURE: source is uninitialized, foreign, or has an incompatible descriptor");
      }
      return gpu;
    },
    submit(encode) {
      assertCurrent();
      let opened = 0;
      let failure: unknown;
      let failed = false;
      const scopes: Promise<GPUError | null>[] = [];
      try {
        device.pushErrorScope("out-of-memory"); opened += 1;
        device.pushErrorScope("validation"); opened += 1;
        const encoder = device.createCommandEncoder({ label: "threenative external compute" });
        const result: unknown = encode(encoder);
        if (result !== undefined) {
          // Consume a mistaken async callback's rejection, but never accept or submit its work.
          if (result !== null && typeof (result as PromiseLike<unknown>).then === "function") {
            void Promise.resolve(result).catch(() => {});
          }
          throw new Error("TN_WEBGPU_SYNCHRONOUS: encode must return void synchronously");
        }
        device.queue.submit([encoder.finish()]);
      } catch (error) { failed = true; failure = error; }
      finally {
        // Close the device-global scope stack before yielding to another render or provider.
        while (opened > 0) {
          opened -= 1;
          try { scopes.push(device.popErrorScope()); }
          catch (error) { scopes.push(Promise.reject(error)); }
        }
      }
      const checked = Promise.all(scopes).then((errors) => {
        if (failed) throw failure;
        const error = errors.find((value) => value !== null);
        if (error !== undefined) throw new Error(`TN_WEBGPU_VALIDATION: ${error.message}`);
      });
      const { done, retired } = fence();
      const completionLoss = watchLoss();
      const completed = Promise.race([
        Promise.all([checked, done]).then(() => { assertCurrent(); }),
        completionLoss.promise.then(() => { throw new Error("TN_WEBGPU_LOST: device lost during external compute"); }),
      ]).finally(completionLoss.release);
      return { completed, retired };
    },
    retire() { return fence().retired; },
  };
}

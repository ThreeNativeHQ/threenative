import { NeuralFrameGate, type NeuralFrameResetReason } from "./frame-gate.js";
import { requireSynchronous, type INeuralCaptureTextures, type INeuralComputeProvider, type INeuralGPUBridge } from "./gpu-contract.js";

/** The actual render hook calls this driver after rendering the source pass, not beforeRender. */
export class NeuralSnapshotDriver {
  readonly #gate = new NeuralFrameGate();
  readonly #bridge: INeuralGPUBridge;
  readonly #provider: INeuralComputeProvider;
  #requested = false;
  #closed = false;
  #error: string | undefined;
  #wallMs: number | undefined;
  #settling: Promise<void> = Promise.resolve();
  #stopping: Promise<void> | undefined;
  readonly estimatedBytes: number;

  constructor(bridge: INeuralGPUBridge, provider: INeuralComputeProvider, maxBytes: number) {
    if (bridge.device !== provider.device) throw new Error("NEURAL_DEVICE: provider belongs to another device");
    for (const dimension of [provider.width, provider.height]) {
      if (!Number.isSafeInteger(dimension) || dimension < 1 || dimension > 512) {
        throw new Error("NEURAL_DIMENSION: valid input must be between 1 and 512 pixels per axis");
      }
    }
    this.estimatedBytes = provider.estimatedBytes + provider.width * provider.height * 16;
    if (!Number.isSafeInteger(provider.estimatedBytes) || provider.estimatedBytes < 0 ||
        !Number.isSafeInteger(this.estimatedBytes) || !Number.isSafeInteger(maxBytes) ||
        maxBytes < 1 || this.estimatedBytes > maxBytes) {
      throw new Error("NEURAL_BUDGET: provider and capture pair exceed the explicit byte cap");
    }
    this.#bridge = bridge;
    this.#provider = provider;
  }

  get state() {
    const gate = this.#gate.state;
    const status = this.#closed ? "disabled" : this.#error !== undefined ? "error" :
      !gate.enabled ? "disabled" : gate.inFlight ? "processing" :
      gate.publishedFrameId !== undefined ? "ready" : "waiting";
    return Object.freeze({ status, error: this.#error, frameId: gate.publishedFrameId,
      frozen: gate.publishedFrameId !== undefined, kind: this.#provider.kind,
      provider: this.#provider.id, temporal: false, wallMs: this.#wallMs,
      estimatedBytes: this.estimatedBytes, width: this.#provider.width, height: this.#provider.height });
  }

  get settled(): Promise<void> { return this.#settling; }

  enable(): void {
    if (this.#closed) throw new Error("NEURAL_CLOSED: this snapshot session has stopped");
    this.#error = undefined;
    this.#gate.setEnabled(true);
  }

  request(): void {
    if (this.#closed || !this.#gate.state.enabled) throw new Error("NEURAL_DISABLED: enable before capture");
    // A snapshot always starts with no temporal history. Never treat repeated stills as adjacent video.
    this.#gate.reset("scene-change");
    this.#wallMs = undefined;
    this.#requested = true;
  }

  reset(reason: NeuralFrameResetReason): void {
    this.#gate.reset(reason);
    this.#requested = false;
    this.#wallMs = undefined;
  }

  /** The capture callback records a GPU copy/resample into the SAME command encoder. */
  afterWorld(frameId: number, capture: (encoder: GPUCommandEncoder) => INeuralCaptureTextures): void {
    if (!this.#requested || !this.#gate.state.enabled || this.#gate.state.inFlight || this.#closed) return;
    this.#gate.request(frameId);
    const ticket = this.#gate.begin(frameId);
    if (ticket === undefined) return;
    this.#requested = false;
    const start = performance.now();
    let job: ReturnType<INeuralGPUBridge["submit"]>;
    try {
      job = this.#bridge.submit((encoder) => {
        const textures = capture(encoder);
        if (textures.original === textures.enhanced) throw new Error("NEURAL_TEXTURE: capture and result must not alias");
        requireSynchronous(this.#provider.encode(encoder, textures), "provider encoding");
      });
    } catch (error) {
      job = { completed: Promise.reject(error), retired: this.#bridge.retire() };
    }
    const outcome = job.completed.then(() => true, (error: unknown) => {
      if (ticket.generation === this.#gate.state.generation && !this.#closed) {
        this.#error = error instanceof Error ? error.message : String(error);
        this.#requested = false;
      }
      return false;
    });
    this.#settling = Promise.all([outcome, job.retired]).then(([succeeded]) => {
      if (this.#gate.complete(ticket, succeeded)) this.#wallMs = performance.now() - start;
    });
  }

  /** Detach the render-chain stage first. No future world draw can submit after this call. */
  stop(): Promise<void> {
    if (this.#stopping !== undefined) return this.#stopping;
    this.#closed = true;
    this.#requested = false;
    this.#gate.setEnabled(false);
    // The second fence covers composition submitted AFTER inference's own retirement fence.
    this.#stopping = this.#settling.then(() => this.#bridge.retire());
    return this.#stopping;
  }
}

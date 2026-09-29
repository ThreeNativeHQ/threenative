/** Scheduling/identity only: no texture capture, GPU submission, or transform-history system. */
const RESET_REASONS = [
  "camera-cut", "scene-change", "projection-change", "resize", "scale-change",
  "provider-change", "model-change", "conditioning-change", "device-recovered",
] as const;
export type NeuralFrameResetReason = (typeof RESET_REASONS)[number];
type GateReason = NeuralFrameResetReason | "enabled" | "disabled" | "device-lost" | "provider-error" | "invalid-frame";

export interface INeuralFrameTicket {
  readonly frameId: number;
  readonly generation: number;
  readonly historyFrameId: number | undefined;
  readonly resetHistory: boolean;
}

export interface INeuralFrameState {
  readonly enabled: boolean;
  readonly generation: number;
  readonly inFlight: boolean;
  readonly pendingFrameId: number | undefined;
  readonly publishedFrameId: number | undefined;
  readonly reason: GateReason;
}

/** Coalesces identities, NOT borrowed live textures. The bridge must supply a coherent source. */
export class NeuralFrameGate {
  #enabled = false;
  #generation = 0;
  #active: INeuralFrameTicket | undefined;
  #pending: number | undefined;
  #lastRequested: number | undefined;
  #history: number | undefined;
  #published: number | undefined;
  #reason: GateReason = "disabled";

  get state(): INeuralFrameState {
    return Object.freeze({ enabled: this.#enabled, generation: this.#generation,
      inFlight: this.#active !== undefined, pendingFrameId: this.#pending,
      publishedFrameId: this.#published, reason: this.#reason });
  }

  setEnabled(enabled: boolean): void {
    if (typeof enabled !== "boolean") throw new Error("NEURAL_ENABLED: expected boolean");
    if (enabled === this.#enabled) return;
    this.#enabled = enabled;
    this.#invalidate(enabled ? "enabled" : "disabled");
  }

  reset(reason: NeuralFrameResetReason): void {
    if (!RESET_REASONS.includes(reason)) throw new Error("NEURAL_RESET: unknown reason");
    this.#invalidate(reason);
  }

  deviceLost(): void {
    this.#enabled = false;
    this.#invalidate("device-lost");
  }

  request(frameId: number): boolean {
    this.#validateFrame(frameId);
    if (!this.#enabled || (this.#lastRequested !== undefined && frameId <= this.#lastRequested)) return false;
    this.#lastRequested = frameId;
    this.#pending = frameId;
    return true;
  }

  /** Call only AFTER the matching source pass is encoded, never from an arbitrary promise callback. */
  begin(renderedFrameId: number): INeuralFrameTicket | undefined {
    this.#validateFrame(renderedFrameId);
    if (!this.#enabled || this.#active !== undefined || this.#pending !== renderedFrameId) return undefined;
    const historyFrameId = this.#history === renderedFrameId - 1 ? this.#history : undefined;
    const ticket = Object.freeze({ frameId: renderedFrameId, generation: this.#generation,
      historyFrameId, resetHistory: historyFrameId === undefined });
    this.#active = ticket;
    this.#pending = undefined;
    return ticket;
  }

  /**
   * Call only once GPU work is retired, or submission failed before any GPU work was queued.
   * A rejected inference promise alone is not retirement. True authorizes identity, not GPU proof.
   */
  complete(ticket: INeuralFrameTicket, succeeded: boolean): boolean {
    if (typeof succeeded !== "boolean") throw new Error("NEURAL_RESULT: expected boolean");
    // Object identity is intentional: copying ticket fields cannot retire someone else's job.
    if (this.#active === undefined || ticket !== this.#active) return false;
    this.#active = undefined;
    if (!this.#enabled || ticket.generation !== this.#generation) return false;
    if (!succeeded) {
      this.#enabled = false;
      this.#invalidate("provider-error");
      return false;
    }
    this.#history = ticket.frameId;
    this.#published = ticket.frameId;
    return true;
  }

  #validateFrame(frameId: number): void {
    if (!Number.isSafeInteger(frameId) || frameId < 0) {
      this.#invalidate("invalid-frame");
      throw new Error("NEURAL_FRAME: expected a non-negative safe integer");
    }
  }

  #invalidate(reason: GateReason): void {
    if (!Number.isSafeInteger(this.#generation + 1)) throw new Error("NEURAL_GENERATION: exhausted");
    this.#generation += 1;
    this.#pending = undefined;
    this.#lastRequested = undefined;
    this.#history = undefined;
    this.#published = undefined;
    this.#reason = reason;
    // Do not release #active: invalidation cannot cancel already-submitted GPU work.
  }
}

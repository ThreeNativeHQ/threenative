export interface INeuralDestroyable {
  /** Synchronous cleanup of this allocation only, never of a borrowed device or shared model. */
  destroy(): void;
}

/** Own allocations individually. Do NOT register upstream Network.destroy(), which may own a device. */
export class NeuralResourceScope {
  #borrowed = new Set<object>();
  #owned = new Set<INeuralDestroyable>();
  #closing = false;
  #retirement: Promise<void> | undefined;

  constructor(borrowed: readonly object[]) {
    for (const resource of borrowed) this.borrow(resource);
  }

  borrow<T extends object>(resource: T): T {
    this.#assertOpen();
    if (resource === null || (typeof resource !== "object" && typeof resource !== "function")) {
      throw new Error("NEURAL_OWNERSHIP: expected an object");
    }
    if (this.#owned.has(resource as INeuralDestroyable))
      throw new Error("NEURAL_OWNERSHIP: already owned");
    this.#borrowed.add(resource);
    return resource;
  }

  own<T extends INeuralDestroyable>(resource: T): T {
    this.#assertOpen();
    if (resource === null || typeof resource?.destroy !== "function") {
      throw new Error("NEURAL_OWNERSHIP: expected a synchronous destroy method");
    }
    if (this.#borrowed.has(resource)) throw new Error("NEURAL_OWNERSHIP: resource is borrowed");
    this.#owned.add(resource);
    return resource;
  }

  /**
   * Fence must fulfill only after GPU work is safe to retire (or loss is confirmed).
   * An inference rejection/abort alone is NOT such a fence. A rejected fence retains allocations
   * and permits retry with a new safe fence, while permanently closing new registrations.
   */
  retireAfter(fence: PromiseLike<void>): Promise<void> {
    if (this.#retirement !== undefined) return this.#retirement;
    if (fence === null || typeof fence?.then !== "function")
      throw new Error("NEURAL_FENCE: required");
    this.#closing = true;
    this.#retirement = Promise.resolve(fence).then(
      () => {
        const errors: unknown[] = [];
        for (const resource of this.#owned) {
          // Remove before calling external code so an exception cannot cause a double destroy.
          this.#owned.delete(resource);
          try {
            resource.destroy();
          } catch (error) {
            errors.push(error);
          }
        }
        this.#borrowed.clear();
        if (errors.length > 0)
          throw new AggregateError(errors, "NEURAL_CLEANUP: one or more allocations failed");
      },
      (error: unknown) => {
        this.#retirement = undefined;
        throw error;
      },
    );
    return this.#retirement;
  }

  #assertOpen(): void {
    if (this.#closing) throw new Error("NEURAL_CLOSED: resource scope is retiring");
  }
}

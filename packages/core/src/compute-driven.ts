import type { Object3D } from "three";
import type { IRendererLike } from "./renderer.js";

/**
 * The lifecycle contract for a game-owned GPU simulation.
 *
 * A compute-driven object owns its kernels, buffers, and appearance. The framework only attaches
 * the active renderer, warms the kernels before the world is shown, dispatches one fixed-step
 * process call, and releases the object when its scene ends.
 */
export interface IComputeDriven {
  /** Kernels to compile before the world is shown. Read once, at attach. */
  readonly warmupNodes: readonly unknown[];
  attachRenderer(renderer: IRendererLike): void;
  /** Dispatched once per fixed step, in scene-add order. */
  process(renderer: IRendererLike): void;
  detach(): void;
  readonly released: boolean;
}

interface IComputeDrivenEntry {
  readonly object: Object3D;
  readonly driven: IComputeDriven;
  readonly warmupNodes: readonly unknown[];
}

/** The ordered registry used by the game loop for all compute-driven scene objects. */
export class ComputeDrivenRegistry {
  #entries = new Map<IComputeDriven, IComputeDrivenEntry>();

  get size(): number {
    return this.#entries.size;
  }

  /** Attach and remember one object. Re-adding the same object is idempotent. */
  add(object: Object3D & IComputeDriven, renderer: IRendererLike): void {
    const driven = object;
    if (this.#entries.has(driven)) return;
    const warmupNodes = [...driven.warmupNodes];
    driven.attachRenderer(renderer);
    this.#entries.set(driven, { object, driven, warmupNodes });
  }

  /** Release one object without disturbing the order of the remaining objects. */
  remove(driven: IComputeDriven): void {
    const entry = this.#entries.get(driven);
    if (entry === undefined) return;
    this.#entries.delete(driven);
    if (!entry.driven.released) entry.driven.detach();
  }

  /** Kernels in the same order as their objects were added to the scene. */
  get warmupNodes(): readonly unknown[] {
    return [...this.#entries.values()].flatMap((entry) => entry.warmupNodes);
  }

  /** Dispatch every live object once; detached scene children are released before dispatch. */
  process(renderer: IRendererLike): void {
    for (const entry of [...this.#entries.values()]) {
      if (entry.driven.released || entry.object.parent === null) {
        this.remove(entry.driven);
        continue;
      }
      entry.driven.process(renderer);
    }
  }

  /** Release every registered object, continuing after a failure so no resource is stranded. */
  clear(): void {
    const failures: unknown[] = [];
    for (const driven of [...this.#entries.keys()]) {
      try {
        this.remove(driven);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw failures[0];
  }
}

export function isComputeDriven(value: unknown): value is IComputeDriven {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<IComputeDriven>;
  return (
    Array.isArray(candidate.warmupNodes) &&
    typeof candidate.attachRenderer === "function" &&
    typeof candidate.process === "function" &&
    typeof candidate.detach === "function" &&
    typeof candidate.released === "boolean"
  );
}

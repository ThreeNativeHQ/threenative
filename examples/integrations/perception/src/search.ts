export type Point3 = readonly [number, number, number];
export interface IObservation { readonly id: string; readonly position: Point3; }
export interface ISearchOptions { readonly memorySeconds: number; readonly arrivalDistance: number; }
export interface ISearchDecision {
  readonly state: 'patrol' | 'chase' | 'search';
  readonly destination: Point3 | null;
  readonly targetId: string | null;
  readonly changed: boolean;
}
export function validatePoint(point: Point3): void {
  if (point.length !== 3 || point.some(value => !Number.isFinite(value)))
    throw new Error('Perception positions must be finite vec3 values.');
}
/** Editable gameplay policy. Receives observations, never an occluded target's current position. */
export class SearchController {
  readonly #memorySeconds: number;
  readonly #arrivalDistance: number;
  #age = 0;
  #memory: IObservation | null = null;
  #state: ISearchDecision['state'] = 'patrol';
  #targetId: string | null = null;
  #disposed = false;
  constructor(options: ISearchOptions) {
    if (!Number.isFinite(options.memorySeconds) || options.memorySeconds <= 0 ||
        !Number.isFinite(options.arrivalDistance) || options.arrivalDistance < 0)
      throw new Error('Perception memory must be positive and arrival distance nonnegative.');
    this.#memorySeconds = options.memorySeconds;
    this.#arrivalDistance = options.arrivalDistance;
  }
  step(dt: number, position: Point3, observation: IObservation | null): ISearchDecision {
    if (this.#disposed) throw new Error('Perception controller is disposed.');
    if (!Number.isFinite(dt) || dt < 0) throw new Error('Perception dt must be finite and nonnegative.');
    validatePoint(position);
    if (observation) {
      if (typeof observation.id !== 'string' || !observation.id.trim()) throw new Error('Perception target id is required.');
      validatePoint(observation.position);
    }
    if (observation) {
      this.#memory = {id: observation.id, position: Object.freeze([...observation.position]) as Point3};
      this.#age = 0;
    } else if (this.#memory) {
      // Saturation avoids losing a small fixed step against a very large absolute wall clock.
      this.#age = Math.min(this.#memorySeconds, this.#age + dt);
      const destination = this.#memory.position;
      if (this.#age >= this.#memorySeconds || Math.hypot(...position.map((v, i) => v - destination[i])) <= this.#arrivalDistance)
        this.#memory = null;
    }
    const state = observation ? 'chase' : this.#memory ? 'search' : 'patrol';
    const targetId = this.#memory?.id ?? null;
    const changed = state !== this.#state || targetId !== this.#targetId;
    this.#state = state; this.#targetId = targetId;
    return Object.freeze({state, targetId, changed, destination: this.#memory?.position ?? null});
  }
  forget(): void { this.#memory = null; this.#age = 0; }
  dispose(): void { this.forget(); this.#disposed = true; }
}

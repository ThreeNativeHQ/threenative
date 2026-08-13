import type { IRandom } from "@threenative/core";
import type { Vector3 } from "three";
import type { IShapeHit } from "../physics.js";

export interface ITargetable {
  readonly dead: boolean;
  readonly id: string;
  readonly mesh: { readonly position: Vector3 };
  takeDamage(amount: number): void;
}

export class JitteredScanClock {
  #elapsed = 0;
  #next: number;
  readonly #maximum: number;
  readonly #minimum: number;
  readonly #random: IRandom;
  scans = 0;

  constructor(random: IRandom, minimum = 0.18, maximum = 0.3) {
    if (!(maximum > minimum) || minimum <= 0) throw new Error("Scan interval bounds are invalid.");
    this.#random = random;
    this.#minimum = minimum;
    this.#maximum = maximum;
    this.#next = random.range(minimum, maximum);
  }

  update(dt: number, scan: () => void): void {
    if (!Number.isFinite(dt) || dt < 0) throw new Error("JitteredScanClock delta must be finite.");
    this.#elapsed += dt;
    while (this.#elapsed >= this.#next) {
      this.#elapsed -= this.#next;
      this.scans += 1;
      scan();
      this.#next = this.#random.range(this.#minimum, this.#maximum);
    }
  }
}

export function nearestFirst(
  hits: readonly IShapeHit[],
  origin: Vector3,
  targets: ReadonlyMap<string, ITargetable>,
): ITargetable | undefined {
  return hits
    .flatMap((hit) => (hit.entity === undefined ? [] : [targets.get(hit.entity)]))
    .filter((target): target is ITargetable => target !== undefined && !target.dead)
    .sort(
      (left, right) =>
        left.mesh.position.distanceToSquared(origin) -
        right.mesh.position.distanceToSquared(origin),
    )[0];
}

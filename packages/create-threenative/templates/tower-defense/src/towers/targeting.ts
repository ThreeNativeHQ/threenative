import type { IRandom } from "@threenative/core";
import type { TargetMode } from "../balance.js";
import type { Enemy } from "../enemies/Enemy.js";

/**
 * Calls `scan` a little more than every tenth of a second, at an interval drawn fresh each time.
 * The jitter is the point: forty towers on one fixed period would all query in the same frame,
 * and the hitch would land on every frame that period divides.
 */
export class JitteredScanClock {
  #elapsed = 0;
  #next: number;
  readonly #maximum: number;
  readonly #minimum: number;
  readonly #random: IRandom;
  scans = 0;

  constructor(random: IRandom, minimum = 0.1, maximum = 0.16) {
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

function flatDistance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * The enemy a tower should shoot: of those within `range` (centre to centre, on the ground plane),
 * the one furthest along the road, the one with the most health, or the nearest.
 */
export function pickTarget(
  candidates: Iterable<Enemy | undefined>,
  origin: { x: number; z: number },
  range: number,
  mode: TargetMode,
): Enemy | undefined {
  let best: Enemy | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const enemy of candidates) {
    if (enemy === undefined || !enemy.active) continue;
    const distance = flatDistance(enemy.position, origin);
    if (distance > range) continue;
    const score = mode === "first" ? enemy.progress : mode === "strongest" ? enemy.hp : -distance;
    if (score > bestScore) {
      bestScore = score;
      best = enemy;
    }
  }
  return best;
}

/** Live enemies within `radius` of `at` on the ground plane. */
export function within(
  enemies: Iterable<Enemy>,
  at: { x: number; z: number },
  radius: number,
): Enemy[] {
  const found: Enemy[] = [];
  for (const enemy of enemies)
    if (enemy.active && flatDistance(enemy.position, at) <= radius) found.push(enemy);
  return found;
}

/** The nearest enemy not already in `hit`, within `radius` of `at`; the next link of a chain. */
export function nearestUnhit(
  enemies: Iterable<Enemy>,
  at: { x: number; z: number },
  radius: number,
  hit: ReadonlySet<Enemy>,
): Enemy | undefined {
  let best: Enemy | undefined;
  let bestDistance = radius;
  for (const enemy of enemies) {
    if (!enemy.active || hit.has(enemy)) continue;
    const distance = flatDistance(enemy.position, at);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = enemy;
    }
  }
  return best;
}

import type { Vector3 } from "three";
import type { Character, PLATFORMER_FEEL } from "../entities/Character.js";

type RespawnTarget = Pick<Character, "body" | "mesh" | "visual">;

export class Checkpoints {
  readonly points: readonly Vector3[];
  readonly maxHearts: number;
  hearts: number;
  currentIndex = 0;
  respawns = 0;
  #invulnerable = 0;
  #feel: typeof PLATFORMER_FEEL;

  constructor(points: readonly Vector3[], maxHearts: number, feel: typeof PLATFORMER_FEEL) {
    if (points.length === 0) throw new Error("Checkpoints requires at least one checkpoint.");
    if (!Number.isInteger(maxHearts) || maxHearts <= 0)
      throw new Error("Checkpoints requires a positive heart count.");
    this.points = points.map((point) => point.clone());
    this.maxHearts = maxHearts;
    this.hearts = maxHearts;
    this.#feel = feel;
  }

  get invulnerable(): boolean {
    return this.#invulnerable > 0;
  }

  update(dt: number, target: RespawnTarget): void {
    if (!Number.isFinite(dt) || dt < 0) throw new Error("Checkpoints.update requires a valid dt.");
    this.#invulnerable = Math.max(0, this.#invulnerable - dt);
    target.visual.visible =
      this.#invulnerable <= 0 || Math.floor(this.#invulnerable * this.#feel.blinkRate) % 2 === 0;
  }

  pass(position: Vector3): void {
    while (this.currentIndex + 1 < this.points.length) {
      const next = this.points[this.currentIndex + 1];
      if (next === undefined || position.x < next.x) break;
      this.currentIndex += 1;
    }
  }

  hurt(target: RespawnTarget, fromX: number): boolean {
    if (this.#invulnerable > 0 || this.hearts <= 0) return false;
    this.hearts -= 1;
    this.#invulnerable = this.#feel.invulnerabilityTime;
    const away = Math.sign(target.mesh.position.x - fromX) || -1;
    target.body.velocity.set(
      away * this.#feel.hurtHorizontalSpeed,
      this.#feel.hurtVerticalSpeed,
      0,
    );
    return true;
  }

  respawn(target: RespawnTarget): void {
    if (this.hearts <= 0) return;
    const point = this.points[this.currentIndex];
    if (point === undefined) throw new Error(`Missing checkpoint ${this.currentIndex}.`);
    target.body.velocity.set(0, 0, 0);
    target.body.teleport(point);
    this.#invulnerable = this.#feel.invulnerabilityTime;
    this.respawns += 1;
  }
}

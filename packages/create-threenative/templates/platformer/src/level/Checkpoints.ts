type CharacterBody3D = {
  body: { setTranslation(value: { x: number; y: number; z: number }, wakeUp: boolean): void };
  velocity: { set(x: number, y: number, z: number): void };
};
type Vector3 = { x: number; y: number; z: number; clone(): Vector3; copy(value: Vector3): Vector3 };
type Object3D = { position: Vector3; visible: boolean };

export interface RespawnTarget {
  readonly body: CharacterBody3D;
  readonly mesh: Object3D;
  readonly visual: Object3D;
}

/** Ordered checkpoints, heart damage, and the short post-respawn blink. */
export class Checkpoints {
  readonly points: readonly Vector3[];
  readonly maxHearts: number;
  hearts: number;
  currentIndex = 0;
  respawns = 0;
  #invulnerable = 0;

  constructor(points: readonly Vector3[], maxHearts = 3) {
    if (points.length === 0) throw new Error("Checkpoints requires at least one checkpoint.");
    if (!Number.isInteger(maxHearts) || maxHearts <= 0)
      throw new Error("Checkpoints requires a positive heart count.");
    this.points = points.map((point) => point.clone());
    this.maxHearts = maxHearts;
    this.hearts = maxHearts;
  }

  get invulnerable(): boolean {
    return this.#invulnerable > 0;
  }

  update(dt: number, target: RespawnTarget): void {
    if (!Number.isFinite(dt) || dt < 0) throw new Error("Checkpoints.update requires a valid dt.");
    this.#invulnerable = Math.max(0, this.#invulnerable - dt);
    target.visual.visible =
      this.#invulnerable <= 0 || Math.floor(this.#invulnerable * 18) % 2 === 0;
  }

  pass(position: Vector3): void {
    while (this.currentIndex + 1 < this.points.length) {
      const next = this.points[this.currentIndex + 1];
      if (next === undefined || position.x < next.x) break;
      this.currentIndex += 1;
    }
  }

  hurt(target: RespawnTarget, fromX: number): boolean {
    if (this.#invulnerable > 0) return false;
    this.hearts -= 1;
    this.#invulnerable = 1.2;
    const away = Math.sign(target.mesh.position.x - fromX) || -1;
    target.body.velocity.set(away * 4.5, 5.5, 0);
    if (this.hearts <= 0) {
      this.hearts = this.maxHearts;
      this.respawn(target);
    }
    return true;
  }

  respawn(target: RespawnTarget): void {
    const point = this.points[this.currentIndex];
    if (point === undefined) throw new Error(`Missing checkpoint ${this.currentIndex}.`);
    target.body.velocity.set(0, 0, 0);
    target.body.body.setTranslation({ x: point.x, y: point.y, z: point.z }, true);
    target.mesh.position.copy(point);
    this.#invulnerable = 1.2;
    this.respawns += 1;
  }
}

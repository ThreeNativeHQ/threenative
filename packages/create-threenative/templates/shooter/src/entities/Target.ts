import type { ICtx, ScheduleHandle } from "@threenative/core";
import { CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import { type Group, Vector3 } from "three";

import { createTargetVisual } from "../render/shapes.js";
import type { GameState } from "../state.js";
import { HOSTILE_LAYER, PLAYER_LAYER, WORLD_LAYER } from "./Player.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

const SCAN_RADIUS = 7;

export class Target {
  readonly mesh: Group;
  readonly body: RigidBody3D;
  readonly tags = ["hostile", "target"];
  readonly wave: number | undefined;
  health: number;
  alive = true;
  acquired = false;
  scanCount = 0;
  #scanHandle: ScheduleHandle | undefined;
  #fireTimer = 0;
  #onFire: (origin: Vector3) => void;
  #scanShape = CollisionShape3D.sphere(SCAN_RADIUS);

  constructor(
    ctx: GameCtx,
    materials: Parameters<typeof createTargetVisual>[0],
    position: Vector3,
    options: {
      readonly health?: number;
      readonly onFire?: (origin: Vector3) => void;
      readonly wave?: number;
    } = {},
  ) {
    this.wave = options.wave;
    this.health = options.health ?? 40;
    this.#onFire = options.onFire ?? (() => undefined);
    this.mesh = createTargetVisual(materials);
    this.mesh.position.copy(position);
    ctx.add(this.mesh);
    this.body = new RigidBody3D({
      collisionLayer: HOSTILE_LAYER,
      collisionMask: WORLD_LAYER,
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.box(1.2, 1.8, 1),
      type: "kinematic",
    });
  }

  startScanning(ctx: GameCtx, playerBodyId: number): void {
    const scan = (): void => {
      if (!this.alive) return;
      this.scanCount += 1;
      const hits = ctx.physics.directSpaceState.intersectShape({
        collisionMask: PLAYER_LAYER,
        maxResults: 4,
        position: this.mesh.position,
        shape: this.#scanShape,
      });
      this.acquired = hits.some((hit) => hit.body.id === playerBodyId);
      this.#scanHandle = ctx.after(ctx.random.range(3, 8) / 60, scan);
    };
    this.#scanHandle = ctx.after(ctx.random.range(3, 8) / 60, scan);
  }

  update(dt: number): void {
    if (!this.alive || !this.acquired) return;
    this.#fireTimer -= dt;
    if (this.#fireTimer > 0) return;
    this.#fireTimer = 6;
    this.#onFire(this.mesh.position.clone().add(new Vector3(0, 0.9, 0)));
  }

  takeDamage(amount: number): boolean {
    if (!this.alive || !Number.isFinite(amount) || amount <= 0) return false;
    this.health = Math.max(0, this.health - amount);
    if (this.health > 0) return false;
    this.alive = false;
    this.mesh.visible = false;
    return true;
  }

  debug(): Record<string, unknown> {
    return {
      acquired: this.acquired,
      alive: this.alive,
      health: this.health,
      position: this.mesh.position.toArray(),
      scanCount: this.scanCount,
      selected: this.acquired ? 1 : 0,
      wave: this.wave ?? 0,
    };
  }

  dispose(): void {
    this.#scanHandle?.cancel();
    this.body.dispose();
    this.mesh.removeFromParent();
  }
}

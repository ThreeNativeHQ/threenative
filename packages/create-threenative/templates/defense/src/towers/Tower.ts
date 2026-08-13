import { CollisionShape3D } from "@threenative/physics";
import type { Group, Vector3 } from "three";
import {
  ATTACKER_LAYER,
  type DefensePhysics,
  type IPhysicsDirectSpaceState,
  TOWER_LAYER,
  createEntityBody,
} from "../physics.js";
import { emitPlaytestEvent } from "../playtest-events.js";
import { tower as towerMesh } from "../render/shapes.js";
import { type ITargetable, JitteredScanClock, nearestFirst } from "./targeting.js";

export const TOWER_RANGE = 5.4;
export const TOWER_DAMAGE = 4;
export const TOWER_RELOAD = 0.55;

export class Tower {
  readonly id: string;
  readonly mesh: Group;
  readonly tags = ["tower", "defense"];
  readonly #body;
  readonly #clock: JitteredScanClock;
  readonly #query: IPhysicsDirectSpaceState;
  readonly #targets: ReadonlyMap<string, ITargetable>;
  #reload = 0;
  #shots = 0;
  #target: ITargetable | undefined;

  constructor(options: {
    readonly id: string;
    readonly physics: DefensePhysics;
    readonly position: Vector3;
    readonly query: IPhysicsDirectSpaceState;
    readonly random: ConstructorParameters<typeof JitteredScanClock>[0];
    readonly targets: ReadonlyMap<string, ITargetable>;
  }) {
    this.id = options.id;
    this.#query = options.query;
    this.#targets = options.targets;
    this.#clock = new JitteredScanClock(options.random);
    this.mesh = towerMesh();
    this.mesh.position.copy(options.position).setY(0);
    this.#body = createEntityBody({
      collisionLayer: TOWER_LAYER,
      collisionMask: ATTACKER_LAYER,
      entity: `tower.${this.id}`,
      object: this.mesh,
      physics: options.physics,
      shape: CollisionShape3D.box(1.55, 1.2, 1.55),
      type: "fixed",
    });
  }

  get scanCount(): number {
    return this.#clock.scans;
  }

  get shots(): number {
    return this.#shots;
  }

  update(dt: number): void {
    this.#clock.update(dt, () => {
      const origin = this.mesh.position.clone().setY(0.6);
      const hits = this.#query.intersectShape({
        collisionMask: ATTACKER_LAYER,
        maxResults: 16,
        position: origin,
        shape: CollisionShape3D.sphere(TOWER_RANGE),
      });
      this.#target = nearestFirst(hits, origin, this.#targets);
    });
    this.#reload = Math.max(0, this.#reload - dt);
    if (this.#target === undefined || this.#target.dead) return;
    if (this.#reload > 0) return;
    this.#target.takeDamage(TOWER_DAMAGE);
    this.#shots += 1;
    this.#reload = TOWER_RELOAD;
    emitPlaytestEvent({ entity: this.id, name: "fired", shots: this.#shots });
  }

  debug(): Record<string, unknown> {
    return {
      position: this.mesh.position.toArray(),
      scanCount: this.scanCount,
      shots: this.#shots,
      target: this.#target?.id ?? "",
    };
  }

  dispose(): void {
    this.#body.dispose();
    this.mesh.removeFromParent();
  }
}

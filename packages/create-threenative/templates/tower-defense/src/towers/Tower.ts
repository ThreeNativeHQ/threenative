import type { IRandom } from "@threenative/core";
import { CollisionShape3D, type PhysicsDirectSpaceState3D } from "@threenative/physics";
import { type Group, Vector3 } from "three";
import {
  ARC_FALLOFF,
  ARC_HOP,
  CRYO_DURATION,
  CRYO_RADIUS,
  type ITowerStats,
  MAX_LEVEL,
  MORTAR_FLIGHT,
  TOWERS,
  type TargetMode,
  type TowerKind,
  towerStats,
} from "../balance.js";
import type { Effects } from "../effects/Effects.js";
import type { Enemy } from "../enemies/Enemy.js";
import { ENEMY_LAYER } from "../physics.js";
import { emitPlaytestEvent } from "../playtest-events.js";
import { palette } from "../render/palette.js";
import { type ITowerModel, tower as towerModel } from "../render/shapes.js";
import { JitteredScanClock, nearestUnhit, pickTarget, within } from "./targeting.js";

/** What a tower needs from the scene, and nothing more: the sky above it and the enemies below. */
export interface ITowerWorld {
  readonly effects: Effects;
  /** Every enemy the scene has built, keyed by the entity name its physics body carries. */
  readonly enemies: ReadonlyMap<string, Enemy>;
  readonly query: PhysicsDirectSpaceState3D;
  readonly random: IRandom;
  onShot(): void;
}

const RANGE_QUERY_HEIGHT = 0.6;
/** Towers are drawn a quarter larger than Bastion's, for the same reason the walkers are. */
const SIZE = 1.25;

export class Tower {
  readonly id: string;
  readonly kind: TowerKind;
  readonly padIndex: number;
  readonly tags = ["tower", "defense"];
  mode: TargetMode = "first";
  /** Credits sunk into this tower: what recycling returns 65% of. */
  invested: number;
  #level = 1;
  #model: ITowerModel;
  #stats: ITowerStats;
  #shape: CollisionShape3D;
  #target: Enemy | undefined;
  #cooldown = 0.1;
  #shots = 0;
  readonly #clock: JitteredScanClock;
  readonly #world: ITowerWorld;
  readonly #muzzle = new Vector3();
  readonly #aim = new Vector3();
  readonly #landing = new Vector3();
  readonly #origin = new Vector3();

  constructor(options: {
    readonly id: string;
    readonly kind: TowerKind;
    readonly padIndex: number;
    readonly position: Vector3;
    readonly world: ITowerWorld;
  }) {
    this.id = options.id;
    this.kind = options.kind;
    this.padIndex = options.padIndex;
    this.invested = TOWERS[options.kind].cost;
    this.#world = options.world;
    this.#clock = new JitteredScanClock(options.world.random);
    this.#model = towerModel(options.kind, 1);
    this.#model.group.name = `tower-${options.id}`;
    this.#model.group.position.copy(options.position).setY(0);
    this.#model.group.scale.setScalar(SIZE);
    this.#stats = towerStats(options.kind, 1);
    this.#shape = CollisionShape3D.sphere(this.#stats.range);
  }

  /** The model's root. It changes when the tower is upgraded, so read it fresh. */
  get group(): Group {
    return this.#model.group;
  }

  get level(): number {
    return this.#level;
  }

  get stats(): ITowerStats {
    return this.#stats;
  }

  get shots(): number {
    return this.#shots;
  }

  get scans(): number {
    return this.#clock.scans;
  }

  get position(): Vector3 {
    return this.group.position;
  }

  /** Raises the level and rebuilds the model in place. False at the top. */
  upgrade(): boolean {
    if (this.#level >= MAX_LEVEL) return false;
    this.#level += 1;
    this.#stats = towerStats(this.kind, this.#level);
    this.#shape = CollisionShape3D.sphere(this.#stats.range);
    const parent = this.group.parent;
    const old = this.#model.group;
    const next = towerModel(this.kind, this.#level);
    next.group.name = old.name;
    next.group.position.copy(old.position);
    next.group.scale.copy(old.scale);
    next.head.rotation.y = this.#model.head.rotation.y;
    parent?.add(next.group);
    old.removeFromParent();
    this.#model = next;
    return true;
  }

  update(dt: number): void {
    this.#clock.update(dt, () => this.#acquire());
    this.#cooldown = Math.max(0, this.#cooldown - dt);
    const target = this.#target;
    if (target === undefined) return;
    const dx = target.position.x - this.group.position.x;
    const dz = target.position.z - this.group.position.z;
    if (!target.active || Math.hypot(dx, dz) > this.#stats.range) {
      this.#target = undefined;
      return;
    }
    this.#model.head.rotation.y = Math.atan2(dx, dz);
    if (this.#cooldown > 0) return;
    this.#cooldown = this.#stats.interval;
    this.#fire(target);
  }

  #acquire(): void {
    const origin = this.#origin.copy(this.group.position).setY(RANGE_QUERY_HEIGHT);
    const hits = this.#world.query.intersectShape({
      collisionMask: ENEMY_LAYER,
      maxResults: 64,
      position: origin,
      shape: this.#shape,
    });
    this.#target = pickTarget(
      hits.map((hit) =>
        hit.entity === undefined ? undefined : this.#world.enemies.get(hit.entity),
      ),
      this.group.position,
      this.#stats.range,
      this.mode,
    );
  }

  #chest(enemy: Enemy): Vector3 {
    return this.#aim.copy(enemy.position).setY(0.65);
  }

  #fire(target: Enemy): void {
    const { effects, enemies, random } = this.#world;
    const stats = this.#stats;
    this.#muzzle.copy(this.#model.muzzle);
    this.#model.head.localToWorld(this.#muzzle);
    const color = palette.towers[this.kind];
    if (this.kind === "sentry") {
      effects.beam(this.#muzzle, this.#chest(target), color);
      effects.burst(this.#chest(target), color, 3, 3);
      target.takeDamage(stats.damage);
    } else if (this.kind === "mortar") {
      // The shell lands where the target *was*: it does not steer, so a fast enemy can outrun it.
      const landing = this.#landing.copy(target.position).setY(0);
      const centre = landing.clone();
      effects.shell(this.#muzzle, centre, MORTAR_FLIGHT, 4, () => {
        effects.ring(centre, stats.splash, color);
        effects.burst(centre, color, 18, 5);
        for (const enemy of within(enemies.values(), centre, stats.splash))
          enemy.takeDamage(stats.damage);
      });
    } else if (this.kind === "arc") {
      const hit = new Set<Enemy>([target]);
      let previous = this.#muzzle.clone();
      let current: Enemy | undefined = target;
      let damage = stats.damage;
      for (let link = 0; current !== undefined && link < stats.chains; link += 1) {
        const point = current.position.clone().setY(0.65);
        effects.bolt(previous, point, color, () => random() - 0.5);
        effects.burst(point, color, 3, 3);
        const struck: Enemy = current;
        struck.takeDamage(damage);
        damage *= ARC_FALLOFF;
        previous = point;
        current = nearestUnhit(enemies.values(), struck.position, ARC_HOP, hit);
        if (current !== undefined) hit.add(current);
      }
    } else {
      effects.beam(this.#muzzle, this.#chest(target), color, 0.18, 0.07);
      effects.ring(target.position, CRYO_RADIUS, color, 0.35);
      for (const enemy of within(enemies.values(), target.position, CRYO_RADIUS)) {
        enemy.chill(stats.slow, CRYO_DURATION);
        enemy.takeDamage(stats.damage);
      }
    }
    this.#shots += 1;
    this.#world.onShot();
    emitPlaytestEvent({ entity: `tower.${this.id}`, name: "fired", shots: this.#shots });
  }

  debug(): Record<string, unknown> {
    return {
      kind: this.kind,
      level: this.#level,
      mode: this.mode,
      pad: this.padIndex,
      position: this.group.position.toArray(),
      scans: this.scans,
      shots: this.#shots,
      target: this.#target?.id ?? "",
    };
  }

  dispose(): void {
    this.#model.group.removeFromParent();
  }
}

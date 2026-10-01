import type { ICtx } from "@threenative/core";
import { CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import { type Material, Mesh, type Quaternion, Vector3 } from "three";
import { CRATE_SIZE, crateGeometry } from "../render/crateShape.js";
import type { GameState } from "../state.js";

/**
 * The two kinds of body in the vault.
 *
 * `solid` crates occupy the default collision layer, so the warden's capsule scans them and is
 * stopped by them. `phase` crates occupy a layer the warden's mask does not include, so they are
 * simulated against the floor and against each other exactly like the solid ones — they fall,
 * stack and are shoved by a solid crate — while the warden's own sweep never sees them.
 *
 * The distinction is a collision layer, not a sensor: a sensor collider would also stop colliding
 * with the crates around it, and a phase crate that fell through the floor would not read as
 * "walk through me", it would read as broken.
 */
export type CrateKind = "phase" | "solid";

/**
 * Three layers, and the third one is the reason this is not two.
 *
 * 1 — solid crates and the warden. 2 — the room: floor, walls. 4 — the ward.
 *
 * The ward has to fall, stack on itself and rest on the floor, so it cannot be a sensor; and it
 * has to be transparent to *everything the player can move*, not only to the warden. A ward that
 * blocked crates while letting the warden through produced a dead level: the warden shoved a crate
 * north, the crate wedged against the ward, and the warden — already touching that crate — could
 * not advance a single millimetre toward the seal. `playerZ` was bit-identical to its spawn value
 * after two hundred ticks of held input, which reads exactly like an input binding that never
 * arrived.
 */
export const SOLID_LAYER = 1;
export const WORLD_LAYER = 2;
export const PHASE_LAYER = 4;
/** Solid crates scan other solid crates, the warden, and the room. Never the ward. */
export const SOLID_MASK = SOLID_LAYER | WORLD_LAYER;
/** The ward scans the room and itself, and nothing else in the vault. */
export const PHASE_MASK = WORLD_LAYER | PHASE_LAYER;
/** What the warden scans: solid crates and the room. */
export const WARDEN_MASK = SOLID_LAYER | WORLD_LAYER;

export interface ICrateOptions {
  /** Names the body for the runner's physics cohort — `settled` matches on this prefix. */
  readonly entity: string;
  readonly kind?: CrateKind;
  /** Restores a full orientation — the replay check rebuilds crates from captured poses. */
  readonly quaternion?: Quaternion;
  readonly rotationY?: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export class Crate {
  readonly mesh: Mesh;
  readonly body: RigidBody3D;
  readonly kind: CrateKind;
  /** Where it was authored, before the opening drop. */
  readonly spawn: Vector3;
  /** Where the drop left it, filled in once the vault has settled. */
  readonly rest = new Vector3();

  constructor(
    ctx: ICtx<GameState, IPhysicsContext>,
    material: Material | readonly Material[],
    options: ICrateOptions,
  ) {
    this.kind = options.kind ?? "solid";
    this.mesh = new Mesh(crateGeometry(), material as Material | Material[]);
    this.mesh.position.set(options.x, options.y, options.z);
    if (options.quaternion === undefined) this.mesh.rotation.y = options.rotationY ?? 0;
    else this.mesh.quaternion.copy(options.quaternion);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.spawn = this.mesh.position.clone();
    this.rest.copy(this.spawn);
    ctx.add(this.mesh);
    this.body = new RigidBody3D({
      // A box shape, not `fromMesh`: the merged brace planks would become a convex hull a
      // centimetre proud of the crate on every face, and a stack of those never sits flush.
      collisionLayer: this.kind === "phase" ? PHASE_LAYER : SOLID_LAYER,
      collisionMask: this.kind === "phase" ? PHASE_MASK : SOLID_MASK,
      // Without a name every body is reported as `physics.body.<n>`, and a `settled` assertion can
      // only address the whole world — which always contains the walls and the floor, and those
      // never sleep. Naming the crates is what makes "the crates came to rest" assertable.
      entity: options.entity,
      // Light, and measured rather than chosen. At 6 kg the warden shoving a crate crossed 2.5 m
      // in 3.3 s instead of 11; at 2.5 kg, six. Rapier bounds a character's push by the
      // character's own mass and no option here exposes it, so the crate is what has to give.
      mass: 1.2,
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.box(CRATE_SIZE, CRATE_SIZE, CRATE_SIZE),
    });
  }

  get speed(): number {
    const velocity = this.body.linearVelocity;
    return Math.hypot(velocity.x, velocity.y, velocity.z);
  }

  /** Metres from where the opening drop left it. Zero until `markRest` has run. */
  displacement(): number {
    return this.mesh.position.distanceTo(this.rest);
  }

  /**
   * Put this body back at a pose without destroying it.
   *
   * `RigidBody3D` has no `teleport` — `CharacterBody3D` does — so the only documented way to move
   * a dynamic body is an impulse or a force, and neither can place one. `syncToPhysics()` is
   * undocumented but is the one member that could plausibly push the object's transform back into
   * the backend, which is what this needs: destroying and recreating forty-four bodies instead
   * changes the order the backend hands out handles, and that alone moved the pile by centimetres.
   */
  reset(position: Vector3, quaternion: Quaternion): void {
    this.mesh.position.copy(position);
    this.mesh.quaternion.copy(quaternion);
    this.body.linearVelocity = { x: 0, y: 0, z: 0 };
    this.body.syncToPhysics();
  }

  markRest(): void {
    this.rest.copy(this.mesh.position);
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
  }
}

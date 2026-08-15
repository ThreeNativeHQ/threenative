import type { ICtx } from "@threenative/core";
import { CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import { Euler, type Material, Mesh, type MeshStandardMaterial } from "three";
import {
  CRATE_SIZE,
  type ICrateSpec,
  LAYER_GOAL,
  LAYER_PHANTOM,
  LAYER_PLAYER,
  LAYER_REACH,
  LAYER_SOLID,
  LAYER_WORLD,
} from "../level/layout.js";
import type { Materials } from "../render/materials.js";
import { crateGeometry } from "../render/shapes.js";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

/**
 * A dynamic crate in one of two classes.
 *
 * `solid` occupies the SOLID layer and the character scans it, so it blocks and
 * gets shoved. `phantom` occupies its own layer that the character's mask leaves
 * out, so the character walks straight through it — while it still falls, stacks
 * and collides with everything else. That is the whole distinction, expressed as
 * two collision layers rather than as a per-frame exception in gameplay code.
 */
export class Crate {
  readonly id: string;
  readonly mesh: Mesh;
  readonly body: RigidBody3D;
  readonly kind: ICrateSpec["kind"];
  readonly role: string;
  readonly tags: readonly string[];
  /** Set by the scene when the character has shoved this crate. */
  pushed = false;
  /** True while the character is standing inside this phantom. */
  occupied = false;

  readonly #panel: Material;
  readonly #baseEmissive: number;

  constructor(ctx: GameCtx, spec: ICrateSpec, materials: Materials) {
    const phantom = spec.kind === "phantom";
    this.id = spec.id;
    // Phantoms own their materials so each one can light up on its own when the
    // character is inside it. Three of them; the 35 solids still share one pair.
    const panel = phantom
      ? materials.phantomPanel.clone()
      : (materials.cratePanels[spec.tint] ?? materials.cratePanels[0]);
    if (panel === undefined) throw new Error("Crate palette slot is missing a material.");
    this.kind = spec.kind;
    this.role = spec.role;
    this.tags = phantom ? ["crate", "phantom"] : ["crate", "solid"];
    this.#panel = panel;
    this.#baseEmissive = (panel as MeshStandardMaterial).emissiveIntensity;
    this.mesh = new Mesh(crateGeometry(CRATE_SIZE), [
      panel,
      phantom ? materials.phantomFrame.clone() : materials.crateFrame,
    ]);
    this.mesh.name = this.id;
    this.mesh.position.set(spec.x, spec.y, spec.z);
    this.mesh.quaternion.setFromEuler(new Euler(0, spec.yaw, 0));
    this.mesh.castShadow = !phantom;
    this.mesh.receiveShadow = !phantom;
    ctx.add(this.mesh);

    this.body = new RigidBody3D({
      collisionLayer: phantom ? LAYER_PHANTOM : LAYER_SOLID,
      // A phantom scans everything except the character and the destination: a
      // body you can walk through must not be a body you can win with.
      collisionMask: phantom
        ? LAYER_WORLD | LAYER_SOLID | LAYER_PHANTOM | LAYER_REACH
        : LAYER_WORLD | LAYER_SOLID | LAYER_PHANTOM | LAYER_PLAYER | LAYER_GOAL | LAYER_REACH,
      entity: this.id,
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.box(CRATE_SIZE, CRATE_SIZE, CRATE_SIZE),
      type: "dynamic",
    });
  }

  /**
   * Light a phantom up while the character is inside it.
   *
   * The HUD readout for this is flushed on a timer, so under a harness that
   * freezes real time it can lag a frame behind. The crate itself cannot: this
   * is the tell that survives a screenshot.
   */
  setOccupied(value: boolean): void {
    if (this.occupied === value || this.kind !== "phantom") return;
    this.occupied = value;
    const material = this.#panel as MeshStandardMaterial;
    material.emissiveIntensity = value ? this.#baseEmissive * 3.4 : this.#baseEmissive;
    material.opacity = value ? 0.62 : 0.42;
  }

  /** What `ctx.entities.snapshot()` reports for this crate. Must stay JSON-safe. */
  debug(): Record<string, number | string | boolean> {
    return {
      kind: this.kind,
      occupied: this.occupied,
      pushed: this.pushed,
      role: this.role,
      x: this.mesh.position.x,
      y: this.mesh.position.y,
      z: this.mesh.position.z,
    };
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
  }
}

const SETTLE_SPEED = 0.05;

/** At rest, read off the body's own motion rather than off a timer. */
export function isSettled(crate: Crate): boolean {
  const velocity = crate.body.linearVelocity;
  return Math.hypot(velocity.x, velocity.y, velocity.z) <= SETTLE_SPEED;
}

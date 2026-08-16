import type { ICtx } from "@threenative/core";
import { CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import { BoxGeometry, type BufferGeometry, EdgesGeometry, LineSegments, Mesh } from "three";
import { LAYER, MASK } from "../layers.js";
import { crateBraceGeometry } from "../render/crateGeometry.js";
import type { Materials } from "../render/materials.js";
import { roundedBox } from "../render/shapes.js";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

let braceGeometry: BufferGeometry | undefined;
let bodyGeometry: BufferGeometry | undefined;

export interface ICrateOptions {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly dye: number;
  readonly yaw?: number;
}

/**
 * A solid crate: dynamic, blocks the player, and can be shoved into the goal.
 * Its collider is an explicit box — a rounded-box trimesh is the wrong shape to
 * hand a dynamic body, and rounded corners are a look, not a physics property.
 */
export class Crate {
  readonly mesh: Mesh;
  readonly body: RigidBody3D;

  constructor(ctx: GameCtx, materials: Materials, options: ICrateOptions) {
    bodyGeometry ??= roundedBox(0.98, 0.98, 0.98, 0.06);
    braceGeometry ??= crateBraceGeometry();
    const material = materials.crates[options.dye % materials.crates.length];
    if (material === undefined) throw new Error("Crate dye out of range.");
    this.mesh = new Mesh(bodyGeometry, material);
    this.mesh.position.set(options.x, options.y, options.z);
    this.mesh.rotation.y = options.yaw ?? 0;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    const braceMaterial = materials.braces[options.dye % materials.braces.length];
    if (braceMaterial === undefined) throw new Error("Crate dye out of range.");
    const braces = new Mesh(braceGeometry, braceMaterial);
    braces.castShadow = true;
    this.mesh.add(braces);
    ctx.add(this.mesh);
    this.body = new RigidBody3D({
      collisionLayer: LAYER.solid,
      collisionMask: MASK.solid,
      mass: 6,
      object: this.mesh,
      shape: CollisionShape3D.box(1, 1, 1),
      physics: ctx.physics,
      type: "dynamic",
    });
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
  }
}

/**
 * The phase crate: same silhouette, holographic, and filtered out of the
 * player's collision mask so the player walks straight through it. It still
 * rests on the floor so it is obviously a body and not a decal.
 */
export class GhostCrate {
  readonly mesh: Mesh;
  readonly body: RigidBody3D;

  constructor(ctx: GameCtx, materials: Materials, options: ICrateOptions) {
    bodyGeometry ??= roundedBox(0.98, 0.98, 0.98, 0.06);
    this.mesh = new Mesh(bodyGeometry, materials.ghost);
    this.mesh.position.set(options.x, options.y, options.z);
    this.mesh.renderOrder = 5;
    const wire = new LineSegments(
      new EdgesGeometry(new BoxGeometry(1.01, 1.01, 1.01)),
      materials.ghostEdge,
    );
    this.mesh.add(wire);
    ctx.add(this.mesh);
    this.body = new RigidBody3D({
      collisionLayer: LAYER.ghost,
      collisionMask: MASK.ghost,
      mass: 3,
      object: this.mesh,
      shape: CollisionShape3D.box(1, 1, 1),
      physics: ctx.physics,
      type: "dynamic",
    });
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
  }
}

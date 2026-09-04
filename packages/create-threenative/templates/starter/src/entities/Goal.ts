import { type ICtx, SoftBody3D } from "@threenative/core";
import { Area3D, CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import { type BufferGeometry, type Material, Matrix4, Mesh } from "three";
import { tessellatePennant } from "../render/pennant.js";
import { block, tube } from "../render/shapes.js";
import type { GameState } from "../state.js";

/**
 * The far side of the gap: a fixed island, a flagpole, and the pennant the packaged glTF
 * proof asset is cut from. Landing anywhere on it ends the run.
 *
 * The island top sits below the ledge on purpose. A same-height landing has to be jumped
 * within a couple of frames of the edge; dropping 0.4 m widens that window to about half
 * a second, which is what makes coyote time feel generous instead of decorative. Its visual
 * slab is shallow because the waterline sits just below the top, so the far island reads as
 * a sandbar rather than a submerged rectangular block.
 */
export const ISLAND = { depth: 2.6, height: 0.1, top: -0.4, width: 3, x: 7.9, z: 0 } as const;
const POLE = { height: 2.4, radius: 0.05, x: 8.4, z: -0.5 } as const;
const PENNANT_SCALE = 0.55;

export interface IGoalMaterials {
  /** The island itself: the same ground the ledge is made of, across the gap. */
  readonly floor: Material;
  /** The pole. The accent role, and the only warm thing on the far side. */
  readonly goal: Material;
}

export class Goal {
  /** The whole marker, so a playtest `visibility` row can ask whether it is on screen. */
  readonly mesh: SoftBody3D;
  readonly pennant: SoftBody3D;
  readonly area: Area3D;
  readonly #body: RigidBody3D;

  constructor(ctx: ICtx<GameState, IPhysicsContext>, materials: IGoalMaterials, pennant: Mesh) {
    // Children carry world coordinates and the group stays at the origin: a physics body
    // reads its object's own transform, and a nested offset would silently desync them.
    const island = block(ISLAND.width, ISLAND.height, ISLAND.depth, materials.floor, {
      radius: 0.16,
    });
    island.position.set(ISLAND.x, ISLAND.top - ISLAND.height / 2, ISLAND.z);
    const pole = tube(POLE.radius, POLE.radius, POLE.height, materials.goal);
    pole.position.set(POLE.x, ISLAND.top + POLE.height / 2, POLE.z);
    // The proof triangle points +x once it is turned on its side, which is a pennant. Its
    // hoist edge lands on the pole; the rest of it flies clear.
    const transform = new Matrix4()
      .makeRotationZ(-Math.PI / 2)
      .premultiply(new Matrix4().makeScale(PENNANT_SCALE, PENNANT_SCALE, PENNANT_SCALE))
      .premultiply(
        new Matrix4().makeTranslation(
          POLE.x + 0.6 * PENNANT_SCALE,
          ISLAND.top + POLE.height - 0.5,
          POLE.z + POLE.radius,
        ),
      );
    const geometry = tessellatePennant(pennant.geometry).applyMatrix4(transform);
    this.pennant = new SoftBody3D(new Mesh(geometry, pennant.material), {
      damping: 1.8,
      gravity: [0, 0, 0],
      pinned: pinnedHoist(geometry),
      readbackEveryFrames: 2,
      stiffness: 36,
      wind: [0, 0, 0],
    });
    this.pennant.name = "finish-flag-cloth";
    this.mesh = this.pennant;
    this.mesh.add(island, pole);
    ctx.add(this.mesh);

    this.#body = new RigidBody3D({
      object: island,
      physics: ctx.physics,
      shape: CollisionShape3D.fromMesh(island),
      type: "fixed",
    });
    // Tall enough to catch a landing, shallow enough that a body still falling past the
    // island's flank in the gap is metres below it and never trips the finish.
    this.area = new Area3D({
      physics: ctx.physics,
      position: { x: ISLAND.x, y: ISLAND.top + 0.8, z: ISLAND.z },
      shape: CollisionShape3D.box(ISLAND.width, 1.6, ISLAND.depth),
    });
  }

  /** Maximum local-Z movement from the authored plane in the latest throttled GPU sample. */
  flagDisplacement(): number {
    const sample = this.pennant.sample;
    if (sample === undefined) return 0;
    let maximum = 0;
    for (let index = 2; index < sample.data.length; index += 3) {
      const z = sample.data[index];
      if (!Number.isFinite(z)) throw new Error(`Starter flag readback was non-finite at ${index}.`);
      maximum = Math.max(maximum, Math.abs((z as number) - (POLE.z + POLE.radius)));
    }
    return maximum;
  }

  readbackLands(): number {
    const stats = this.pennant.debug().readbackStats;
    if (typeof stats !== "object" || stats === null || !("lands" in stats)) return 0;
    const lands = (stats as { lands?: unknown }).lands;
    return typeof lands === "number" ? lands : 0;
  }

  dispose(): void {
    this.area.dispose();
    this.#body.dispose();
    this.mesh.removeFromParent();
  }
}

function pinnedHoist(geometry: BufferGeometry): number[] {
  const positions = geometry.getAttribute("position");
  if (positions === undefined) throw new Error("Starter flag geometry has no positions.");
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 0; index < positions.count; index += 1)
    minimum = Math.min(minimum, positions.getX(index));
  const pinned: number[] = [];
  for (let index = 0; index < positions.count; index += 1)
    if (Math.abs(positions.getX(index) - minimum) < 1e-6) pinned.push(index);
  if (pinned.length === 0) throw new Error("Starter flag geometry has no hoist vertices.");
  return pinned;
}

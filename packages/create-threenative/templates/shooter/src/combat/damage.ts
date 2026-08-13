import type { IPhysicsContext } from "@threenative/physics";
import { CollisionShape3D } from "@threenative/physics";
import type { Vector3 } from "three";
import { HOSTILE_LAYER } from "../entities/Player.js";
import type { Target } from "../entities/Target.js";
import { directSpaceState } from "../physics.js";

export function applyDirectDamage(
  targets: ReadonlyMap<number, Target>,
  bodyId: number,
  amount: number,
): boolean {
  const target = targets.get(bodyId);
  return target?.takeDamage(amount) ?? false;
}

export function applyRadiusDamage(
  physics: IPhysicsContext,
  centre: Vector3,
  radius: number,
  amount: number,
  targets: ReadonlyMap<number, Target>,
): Set<number> {
  const hits = directSpaceState(physics).intersectShape({
    collisionMask: HOSTILE_LAYER,
    maxResults: 16,
    position: centre,
    shape: CollisionShape3D.sphere(radius),
  });
  const defeated = new Set<number>();
  for (const hit of hits) {
    const target = targets.get(hit.body.id);
    if (target === undefined || !target.alive) continue;
    // Candidate discovery is the physics query. This single falloff calculation is the weapon's
    // design, not a JavaScript distance scan over the level.
    const distance = target.mesh.position.distanceTo(centre);
    const falloff = Math.max(0, 1 - distance / radius);
    if (target.takeDamage(amount * Math.max(0.25, falloff))) defeated.add(hit.body.id);
  }
  return defeated;
}

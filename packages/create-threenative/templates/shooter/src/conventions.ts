import { GroundSnap, attachToBone, normaliseToMetres, skeletonBones } from "@threenative/core";
import { Bone, type Group } from "three";
import { scale } from "./render/scale.js";

export interface IShooterConventions {
  readonly applyGrounding: (surfaceY: number, dt: number) => void;
  readonly attachedBone: string;
  readonly boneNames: readonly string[];
  readonly groundSnap: GroundSnap;
  readonly normaliseFactor: number;
}

/**
 * The three conventions this kit turns on, in one place.
 *
 * - `normaliseToMetres` sizes the carbine. The viewmodel is authored at whatever size was
 *   convenient to lay out; the metre table in `render/scale.ts` decides what it actually is, so a
 *   replacement model dropped in from an asset site lands at the same size without a magic number
 *   beside it.
 * - `attachToBone` puts the weapon in the hand that holds it. The hand is a real `Bone`, so
 *   swapping the procedural arms for a rigged pair keeps the same call.
 * - `GroundSnap` keeps the boots on the floor. In first person you only see them when you look
 *   down, which is exactly when a hovering foot is obvious.
 *
 * Every one of them reports honestly when overridden: `groundSnap.enabled = false` keeps measuring
 * and keeps `clearance` truthful.
 */
export function preparePlayerConventions(viewmodel: Group, legs: Group): IShooterConventions {
  const weapon = viewmodel.getObjectByName("held-rifle");
  if (weapon === undefined) throw new Error("Shooter viewmodel is missing its held rifle.");

  const normaliseFactor = normaliseToMetres(weapon, { axis: "longest", metres: scale.rifleLength });
  const hand = new Bone();
  hand.name = "RightHand";
  hand.position.copy(weapon.position);
  hand.rotation.copy(weapon.rotation);
  viewmodel.add(hand);
  weapon.position.set(0, 0, 0);
  weapon.rotation.set(0, 0, 0);

  const boneNames = skeletonBones(viewmodel);
  attachToBone(viewmodel, "RightHand", weapon);
  const groundSnap = new GroundSnap(legs);
  return {
    applyGrounding: (surfaceY, dt) => groundSnap.apply(legs, surfaceY, dt),
    attachedBone: weapon.parent?.name ?? "",
    boneNames,
    groundSnap,
    normaliseFactor,
  };
}

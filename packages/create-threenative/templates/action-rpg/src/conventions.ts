import { GroundSnap, attachToBone, normaliseToMetres, skeletonBones } from "@threenative/core";
import { Bone, type Group } from "three";

export interface IActionRpgConventions {
  readonly applyGrounding: (surfaceY: number, dt: number) => void;
  readonly attachedBone: string;
  readonly boneNames: readonly string[];
  readonly groundSnap: GroundSnap;
  readonly normaliseFactor: number;
}

export function preparePlayerConventions(model: Group): IActionRpgConventions {
  const weapon = model.getObjectByName("held-blade");
  if (weapon === undefined) throw new Error("Action RPG player is missing its held blade.");

  const normaliseFactor = normaliseToMetres(weapon, { axis: "longest", metres: 0.9 });
  const hand = new Bone();
  hand.name = "RightHand";
  hand.position.copy(weapon.position);
  hand.rotation.copy(weapon.rotation);
  model.add(hand);
  weapon.position.set(0, 0, 0);
  weapon.rotation.set(0, 0, 0);

  const boneNames = skeletonBones(model);
  attachToBone(model, "RightHand", weapon);
  const groundSnap = new GroundSnap(model);
  return {
    applyGrounding: (surfaceY, dt) => groundSnap.apply(model, surfaceY, dt),
    attachedBone: weapon.parent?.name ?? "",
    boneNames,
    groundSnap,
    normaliseFactor,
  };
}

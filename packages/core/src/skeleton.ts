import { type Bone, Box3, type Object3D, Vector3 } from "three";
import { type ThreePoseVector, measureThreePose } from "./pose-measure.js";

function isBone(object: Object3D): object is Bone {
  return (object as Bone).isBone === true;
}

/** Every bone under `root` in traversal order. Internal: `skeletonBones` is the public surface. */
export function bonesIn(root: Object3D): Bone[] {
  const bones: Bone[] = [];
  root.traverse((object) => {
    if (isBone(object)) bones.push(object);
  });
  return bones;
}

function requireBone(root: Object3D, boneName: string): Bone {
  const bones = bonesIn(root);
  const bone = bones.find((candidate) => candidate.name === boneName);
  if (bone === undefined) {
    const available =
      bones.map((candidate) => candidate.name || "(unnamed)").join(", ") || "(none)";
    throw new Error(`Bone '${boneName}' not found. Available bones: ${available}.`);
  }
  return bone;
}

function preserveScale(value: number, attachedScale: number, localScale: number): number {
  return attachedScale === 0 ? 1 : (localScale * value) / attachedScale;
}

/** Names of every bone in traversal order. Empty for an unskinned model. */
export function skeletonBones(root: Object3D): readonly string[] {
  return bonesIn(root).map((bone) => bone.name);
}

/** Parent a child to a named bone while preserving the child's authored world scale. */
export function attachToBone(root: Object3D, boneName: string, child: Object3D): Object3D {
  const bone = requireBone(root, boneName);

  const childScale = new Vector3();
  child.getWorldScale(childScale);
  bone.add(child);
  const attachedScale = new Vector3();
  child.getWorldScale(attachedScale);
  const localScale = child.scale.clone();
  child.scale.set(
    preserveScale(childScale.x, attachedScale.x, localScale.x),
    preserveScale(childScale.y, attachedScale.y, localScale.y),
    preserveScale(childScale.z, attachedScale.z, localScale.z),
  );
  return child;
}

/** How far a bone sits from the object it is supposed to be touching. */
export interface IBoneContactReport {
  readonly bone: string;
  readonly target: string;
  /** Metres from the bone to the nearest point of the target's world bounds. Zero when inside. */
  readonly distance: number;
  readonly inside: boolean;
  readonly bonePosition: ThreePoseVector;
  readonly targetPoint: ThreePoseVector;
}

/**
 * Measure whether a named bone reaches a game object, in metres.
 *
 * This turns "his hands are on the keyboard" and "he is sitting on the chair" into numbers a
 * scenario can assert. It walks the target's vertices through `measureThreePose`, so call it on
 * a check or a debug sample rather than every frame.
 */
export function boneContact(
  root: Object3D,
  boneName: string,
  target: Object3D,
): IBoneContactReport {
  const bone = requireBone(root, boneName);
  const bonePose = measureThreePose(bone, { bounds: false });
  const targetPose = measureThreePose(target);
  if (targetPose.bounds === null) {
    throw new Error(`boneContact could not measure '${target.name || target.type}'.`);
  }

  const position = new Vector3(...bonePose.position);
  const bounds = new Box3(
    new Vector3(...targetPose.bounds.min),
    new Vector3(...targetPose.bounds.max),
  );
  const nearest = bounds.clampPoint(position, new Vector3());
  const distance = nearest.distanceTo(position);
  return {
    bone: bone.name,
    target: target.name || target.type,
    distance,
    inside: distance === 0,
    bonePosition: bonePose.position,
    targetPoint: [nearest.x, nearest.y, nearest.z],
  };
}

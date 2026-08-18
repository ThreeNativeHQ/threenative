import { type Bone, type Object3D, Vector3 } from "three";

function isBone(object: Object3D): object is Bone {
  return (object as Bone).isBone === true;
}

function bonesIn(root: Object3D): Bone[] {
  const bones: Bone[] = [];
  root.traverse((object) => {
    if (isBone(object)) bones.push(object);
  });
  return bones;
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
  const bones = bonesIn(root);
  const bone = bones.find((candidate) => candidate.name === boneName);
  if (bone === undefined) {
    const available =
      bones.map((candidate) => candidate.name || "(unnamed)").join(", ") || "(none)";
    throw new Error(`Bone '${boneName}' not found. Available bones: ${available}.`);
  }

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

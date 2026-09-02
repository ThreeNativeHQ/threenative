import {
  AnimationClip,
  AnimationMixer,
  Bone,
  type Bone as BoneType,
  type BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  LoopOnce,
  type Material,
  Quaternion,
  QuaternionKeyframeTrack,
  Skeleton,
  SkinnedMesh,
  Vector3,
} from "three";

export const CHAIN = ["Hips", "Spine", "Arm", "Hand"] as const;
export const SEGMENT = 0.4;
// A retarget bakes the source at a real frame rate; 65 keys over one second is 64 fps. Sparser
// keys make the clip a different animation from the one it was retargeted from, and the score
// then reports that difference rather than the retarget.
const KEYS = Array.from({ length: 65 }, (_, index) => index / 64);

export interface IRig {
  readonly root: Group;
  readonly bones: readonly BoneType[];
  readonly bind: ReadonlyMap<string, Quaternion>;
}

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`the fixture has no ${what}`);
  return value;
}

export function boneOf(rig: IRig, name: string): BoneType {
  return must(
    rig.bones.find((bone) => bone.name === name),
    `bone ${name}`,
  );
}

/** A limb whose vertices are weighted to whichever bone segment they stand in. */
function limbGeometry(): BufferGeometry {
  const length = SEGMENT * (CHAIN.length - 1);
  const geometry = new CylinderGeometry(0.07, 0.11, length, 12, 12);
  geometry.translate(0, length / 2 + SEGMENT, 0);
  const position = must(geometry.getAttribute("position"), "limb positions");
  const indices: number[] = [];
  const weights: number[] = [];
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const height = (position.getY(vertex) - SEGMENT) / SEGMENT;
    const lower = Math.max(0, Math.min(CHAIN.length - 1, Math.floor(height)));
    const upper = Math.min(CHAIN.length - 1, lower + 1);
    const blend = Math.max(0, Math.min(1, height - lower));
    indices.push(lower, upper, 0, 0);
    weights.push(1 - blend, blend, 0, 0);
  }
  geometry.setAttribute("skinIndex", new Float32BufferAttribute(indices, 4));
  geometry.setAttribute("skinWeight", new Float32BufferAttribute(weights, 4));
  return geometry;
}

/**
 * A four-bone chain, optionally with a twist in `Arm`'s bind pose.
 *
 * The twist is about the bone's own axis, so a rig built with it stands in exactly the same place
 * as one built without it. That is the whole difficulty: the two rigs disagree about nothing a
 * bone-direction check can see, and about 90 degrees of roll that tears the skin.
 */
export function buildRig(name: string, material: Material, twistDegrees: number): IRig {
  const mesh = new SkinnedMesh(limbGeometry(), material);
  mesh.name = `${name}-skin`;
  mesh.frustumCulled = false;

  const bones: BoneType[] = [];
  let parent: BoneType | undefined;
  for (const boneName of CHAIN) {
    const bone = new Bone();
    bone.name = boneName;
    bone.position.y = SEGMENT;
    if (parent === undefined) mesh.add(bone);
    else parent.add(bone);
    if (boneName === "Arm") {
      bone.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), (twistDegrees * Math.PI) / 180);
    }
    bones.push(bone);
    parent = bone;
  }

  const root = new Group();
  root.name = name;
  root.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new Skeleton(bones));
  return {
    root,
    bones,
    bind: new Map(bones.map((bone) => [bone.name, bone.quaternion.clone()])),
  };
}

function toBindPose(rig: IRig): void {
  for (const bone of rig.bones) bone.quaternion.copy(must(rig.bind.get(bone.name), bone.name));
  rig.root.updateMatrixWorld(true);
}

function worldRotations(rig: IRig): Map<string, Quaternion> {
  rig.root.updateMatrixWorld(true);
  return new Map(rig.bones.map((bone) => [bone.name, bone.getWorldQuaternion(new Quaternion())]));
}

/** The source animation: the spine and arm reach forward and down across one second. */
export function sourceClip(): AnimationClip {
  const spine = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.5);
  const arm = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.85);
  return new AnimationClip("Reach", 1, [
    new QuaternionKeyframeTrack(
      "Spine.quaternion",
      [0, 1],
      [0, 0, 0, 1, spine.x, spine.y, spine.z, spine.w],
    ),
    new QuaternionKeyframeTrack("Arm.quaternion", [0, 1], [0, 0, 0, 1, arm.x, arm.y, arm.z, arm.w]),
  ]);
}

function sampleWorld(rig: IRig, clip: AnimationClip): Map<string, Quaternion>[] {
  const mixer = new AnimationMixer(rig.root);
  const action = mixer.clipAction(clip);
  action.setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const frames: Map<string, Quaternion>[] = [];
  let elapsed = 0;
  for (const time of KEYS) {
    mixer.update(time - elapsed);
    elapsed = time;
    frames.push(worldRotations(rig));
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(rig.root);
  toBindPose(rig);
  return frames;
}

/**
 * Where a bone ends up at the end of `clip`, with the rig put back to its bind pose afterwards.
 *
 * Reading it without the restore is how the third defect hides: a bone the next clip does not
 * drive keeps the pose this one left it in, and the gap the contact check should have reported
 * closes for a reason that has nothing to do with the clip being measured.
 */
export function boneAtEnd(rig: IRig, boneName: string, clip: AnimationClip): Vector3 {
  toBindPose(rig);
  const mixer = new AnimationMixer(rig.root);
  const action = mixer.clipAction(clip);
  // Stepping a repeating action by exactly its duration wraps it back to zero, which reads as
  // "the animation does nothing" rather than "the animation ended here".
  action.setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  mixer.update(clip.duration);
  rig.root.updateMatrixWorld(true);
  const position = boneOf(rig, boneName).getWorldPosition(new Vector3());
  mixer.stopAllAction();
  mixer.uncacheRoot(rig.root);
  toBindPose(rig);
  return position;
}

export interface IRetargetOptions {
  /** `"delta"` preserves each bone's rotation relative to its own bind pose. `"world"` is the bug. */
  readonly convert: "delta" | "world";
  /** Bones the written clip drives. Every other bone keeps whatever the previous clip left it in. */
  readonly drive?: readonly string[];
  /** Bones whose track is written with the wrong glTF target path, so it binds nothing. */
  readonly misname?: readonly string[];
}

/** Write a clip for `target` from a clip authored on `source`. */
export function retargetedClip(
  source: IRig,
  target: IRig,
  clip: AnimationClip,
  options: IRetargetOptions,
): AnimationClip {
  toBindPose(source);
  const sourceRest = worldRotations(source);
  toBindPose(target);
  const targetRest = worldRotations(target);
  const frames = sampleWorld(source, clip);
  const values = new Map<string, number[]>(CHAIN.map((name) => [name, []]));

  for (const frame of frames) {
    let parent = new Quaternion();
    for (const name of CHAIN) {
      const world = must(frame.get(name), name).clone();
      const wanted =
        options.convert === "world"
          ? world
          : world
              .multiply(must(sourceRest.get(name), name).clone().invert())
              .multiply(must(targetRest.get(name), name));
      const local = parent.clone().invert().multiply(wanted);
      parent = wanted;
      must(values.get(name), name).push(local.x, local.y, local.z, local.w);
    }
  }

  const driven = options.drive ?? CHAIN;
  const tracks = CHAIN.filter((name) => driven.includes(name)).map((name) => {
    const property = options.misname?.includes(name) === true ? "undefined" : "quaternion";
    return new QuaternionKeyframeTrack(`${name}.${property}`, KEYS, must(values.get(name), name));
  });
  return new AnimationClip(`Reach-${options.convert}`, 1, tracks);
}

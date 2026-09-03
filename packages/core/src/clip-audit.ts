import {
  type AnimationClip,
  AnimationMixer,
  type Bone,
  MathUtils,
  type Object3D,
  PropertyBinding,
  Quaternion,
  type SkinnedMesh,
  type Vector3,
  getConsoleFunction,
  setConsoleFunction,
} from "three";
import { bonesIn } from "./skeleton.js";

/** One track of a clip, and whether it resolves to a real property on a root. */
export interface IClipTrackBinding {
  readonly track: string;
  /** The node the track names, or `null` when nothing under the root carries that name. */
  readonly node: string | null;
  readonly bound: boolean;
  /** Three.js's own reason the track binds nothing. `null` when it binds. */
  readonly reason: string | null;
}

export interface IClipBindingReport {
  readonly clip: string;
  readonly tracks: number;
  readonly bound: number;
  /** Every track that drives nothing, in clip order. */
  readonly unbound: readonly IClipTrackBinding[];
}

export interface IClipCoverageReport {
  readonly clip: string;
  readonly bones: number;
  readonly driven: readonly string[];
  /** Bones no bound track touches. They hold whatever the previous clip left them in. */
  readonly undriven: readonly string[];
}

export interface IClipPoseSubject {
  readonly root: Object3D;
  readonly clip: AnimationClip;
}

export interface IClipPoseErrorOptions {
  /** Measured bone name to reference bone name. Defaults to the names the two rigs share. */
  readonly bones?: Readonly<Record<string, string>>;
  /** Poses compared across the clip. Defaults to 8. */
  readonly samples?: number;
}

export interface IBonePoseError {
  readonly bone: string;
  readonly reference: string;
  readonly meanDegrees: number;
  readonly maxDegrees: number;
  readonly maxAtSeconds: number;
}

export interface IClipPoseErrorReport {
  readonly clip: string;
  readonly referenceClip: string;
  readonly samples: number;
  readonly meanDegrees: number;
  readonly maxDegrees: number;
  /** Every compared bone, worst mean first. */
  readonly bones: readonly IBonePoseError[];
}

interface IResolvedTrack {
  readonly binding: IClipTrackBinding;
  readonly node: Object3D | null;
}

interface IPropertyBindingWithTarget extends PropertyBinding {
  readonly targetObject?: unknown;
}

function label(object: Object3D): string {
  return object.name || object.type;
}

/**
 * Bind one track the way `AnimationMixer` does and capture the reason it fails.
 *
 * `PropertyBinding.bind()` reports every bail-out through Three.js's console hook and binds
 * nothing after it, so a captured message is exactly "this track drives nothing" — with Three.js's
 * own wording. Reading it through `setConsoleFunction` keeps the diagnostic out of the page
 * console, where it would fail a scenario's `noConsoleErrors` before anyone read it.
 */
function bindTrack(root: Object3D, path: string): IResolvedTrack {
  let nodeName: string;
  try {
    nodeName = PropertyBinding.parseTrackName(path).nodeName;
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    return { binding: { track: path, node: null, bound: false, reason }, node: null };
  }

  const previous = getConsoleFunction();
  let failure: string | null = null;
  setConsoleFunction((type, message) => {
    if (failure === null && type !== "log") failure = message;
  });
  const propertyBinding = new PropertyBinding(root, path);
  try {
    propertyBinding.bind();
  } finally {
    setConsoleFunction(previous);
  }

  const reportedNode = PropertyBinding.findNode(root, nodeName) as Object3D | null;
  const bound = failure === null;
  const target = (propertyBinding as IPropertyBindingWithTarget).targetObject;
  const resolvedNode =
    bound &&
    target !== null &&
    typeof target === "object" &&
    (target as { isObject3D?: unknown }).isObject3D === true
      ? (target as Object3D)
      : null;
  return {
    binding: {
      track: path,
      node: bound || reportedNode !== null ? nodeName : null,
      bound,
      reason: failure,
    },
    node: resolvedNode,
  };
}

function resolveTracks(root: Object3D, clip: AnimationClip, caller: string): IResolvedTrack[] {
  if (clip.tracks.length === 0) {
    throw new Error(`${caller}: clip '${clip.name}' has no tracks, so it animates nothing.`);
  }
  return clip.tracks.map((track) => bindTrack(root, track.name));
}

/**
 * Report which of a clip's tracks resolve to a real property on `root`.
 *
 * A retarget that writes the wrong glTF target path produces tracks named `<bone>.undefined`:
 * they load without error, bind nothing, and the character plays its bind pose.
 */
export function clipTrackBindings(root: Object3D, clip: AnimationClip): IClipBindingReport {
  const resolved = resolveTracks(root, clip, "clipTrackBindings");
  const unbound = resolved.filter(({ binding }) => !binding.bound).map(({ binding }) => binding);
  return {
    clip: clip.name,
    tracks: resolved.length,
    bound: resolved.length - unbound.length,
    unbound,
  };
}

/**
 * Report which bones of `root` a clip does not drive.
 *
 * An undriven bone keeps whatever the previous clip left it in, so a rig whose clips cover 22 of
 * 65 bones carries the last walk cycle's hand shape into every pose that follows.
 */
export function clipBoneCoverage(root: Object3D, clip: AnimationClip): IClipCoverageReport {
  const bones = bonesIn(root);
  if (bones.length === 0) {
    throw new Error(`clipBoneCoverage: '${label(root)}' has no bones.`);
  }
  const driven = new Set<Object3D>();
  for (const { node } of resolveTracks(root, clip, "clipBoneCoverage")) {
    if (node !== null) driven.add(node);
  }
  const drivenNames: string[] = [];
  const undrivenNames: string[] = [];
  for (const bone of bones) (driven.has(bone) ? drivenNames : undrivenNames).push(bone.name);
  return {
    clip: clip.name,
    bones: bones.length,
    driven: drivenNames,
    undriven: undrivenNames,
  };
}

interface ITransformSnapshot {
  readonly object: Object3D;
  readonly position: Vector3;
  readonly quaternion: Quaternion;
  readonly scale: Vector3;
}

function snapshotTransforms(root: Object3D): ITransformSnapshot[] {
  const snapshot: ITransformSnapshot[] = [];
  root.traverse((object) => {
    snapshot.push({
      object,
      position: object.position.clone(),
      quaternion: object.quaternion.clone(),
      scale: object.scale.clone(),
    });
  });
  return snapshot;
}

function restoreTransforms(root: Object3D, snapshot: readonly ITransformSnapshot[]): void {
  for (const entry of snapshot) {
    entry.object.position.copy(entry.position);
    entry.object.quaternion.copy(entry.quaternion);
    entry.object.scale.copy(entry.scale);
  }
  root.updateMatrixWorld(true);
}

/** A bone on each rig, its rest rotation on each rig, and the error accumulated so far. */
interface IPairState {
  readonly bone: string;
  readonly reference: string;
  readonly subjectBone: Bone;
  readonly referenceBone: Bone;
  readonly subjectRest: Quaternion;
  readonly referenceRest: Quaternion;
  sum: number;
  max: number;
  at: number;
}

/** Return every skeleton under `root` to its bind pose, so rest rotations are read, not assumed. */
function toBindPose(root: Object3D): void {
  root.traverse((object) => {
    const skinned = object as SkinnedMesh;
    if (skinned.isSkinnedMesh === true) skinned.skeleton.pose();
  });
  root.updateMatrixWorld(true);
}

function boneByName(root: Object3D, name: string, side: string): Bone {
  const bone = bonesIn(root).find((candidate) => candidate.name === name);
  if (bone === undefined) {
    throw new Error(`clipPoseError: the ${side} rig '${label(root)}' has no bone named '${name}'.`);
  }
  return bone;
}

function boneNamePairs(
  subject: Object3D,
  reference: Object3D,
  requested: Readonly<Record<string, string>> | undefined,
): readonly (readonly [string, string])[] {
  if (requested !== undefined) {
    const pairs = Object.entries(requested);
    if (pairs.length === 0) throw new Error("clipPoseError: bones must name at least one pair.");
    return pairs;
  }
  const referenceNames = new Set(bonesIn(reference).map((bone) => bone.name));
  const shared = bonesIn(subject)
    .map((bone) => bone.name)
    .filter((name) => referenceNames.has(name))
    .map((name) => [name, name] as const);
  if (shared.length === 0) {
    throw new Error(
      "clipPoseError: the two rigs share no bone names. Pass bones to map one rig onto the other.",
    );
  }
  return shared;
}

function duration(subject: IClipPoseSubject, side: string): number {
  const seconds = subject.clip.duration;
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`clipPoseError: the ${side} clip '${subject.clip.name}' has no duration.`);
  }
  return seconds;
}

function isSameOrAncestor(ancestor: Object3D, object: Object3D): boolean {
  let current: Object3D | null = object;
  while (current !== null) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

function assertDisjointRoots(subject: Object3D, reference: Object3D): void {
  if (isSameOrAncestor(subject, reference) || isSameOrAncestor(reference, subject)) {
    throw new Error(
      `clipPoseError: subject and reference roots overlap ('${label(subject)}' and '${label(reference)}'); pass two disjoint roots.`,
    );
  }
}

/**
 * Score how far a clip's pose is from the same pose on a reference rig, in degrees.
 *
 * Each bone is compared as its world rotation *relative to its own rig's bind pose*, as a whole
 * quaternion. The delta makes the two rigs' bind conventions cancel, so rigs whose arms sit 90
 * degrees apart at rest still score zero when the retarget is right; the whole quaternion makes
 * twist count, which a bone-direction check cannot see — a forearm rolled about its own axis
 * points exactly where it should while the skin between elbow and wrist tears into a smear.
 *
 * Both rigs are driven and then restored to the transforms they arrived with.
 */
export function clipPoseError(
  subject: IClipPoseSubject,
  reference: IClipPoseSubject,
  options: IClipPoseErrorOptions = {},
): IClipPoseErrorReport {
  const samples = options.samples ?? 8;
  if (!Number.isInteger(samples) || samples < 1) {
    throw new Error(`clipPoseError: samples must be a positive integer, received ${samples}.`);
  }
  assertDisjointRoots(subject.root, reference.root);
  const names = boneNamePairs(subject.root, reference.root, options.bones);
  const subjectSeconds = duration(subject, "measured");
  const referenceSeconds = duration(reference, "reference");
  const pairs: IPairState[] = names.map(([bone, referenceBone]) => ({
    bone,
    reference: referenceBone,
    subjectBone: boneByName(subject.root, bone, "measured"),
    referenceBone: boneByName(reference.root, referenceBone, "reference"),
    subjectRest: new Quaternion(),
    referenceRest: new Quaternion(),
    sum: 0,
    max: 0,
    at: 0,
  }));

  const subjectSnapshot = snapshotTransforms(subject.root);
  const referenceSnapshot = snapshotTransforms(reference.root);
  const subjectMixer = new AnimationMixer(subject.root);
  const referenceMixer = new AnimationMixer(reference.root);
  try {
    toBindPose(subject.root);
    toBindPose(reference.root);
    for (const pair of pairs) {
      pair.subjectBone.getWorldQuaternion(pair.subjectRest);
      pair.referenceBone.getWorldQuaternion(pair.referenceRest);
    }
    subjectMixer.clipAction(subject.clip).play();
    referenceMixer.clipAction(reference.clip).play();

    const measured = new Quaternion();
    const expected = new Quaternion();
    const world = new Quaternion();
    let elapsedSubject = 0;
    let elapsedReference = 0;
    for (let sample = 0; sample < samples; sample += 1) {
      const phase = (sample + 0.5) / samples;
      const subjectTime = subjectSeconds * phase;
      const referenceTime = referenceSeconds * phase;
      subjectMixer.update(subjectTime - elapsedSubject);
      referenceMixer.update(referenceTime - elapsedReference);
      elapsedSubject = subjectTime;
      elapsedReference = referenceTime;
      subject.root.updateMatrixWorld(true);
      reference.root.updateMatrixWorld(true);

      for (const pair of pairs) {
        deltaFromRest(pair.subjectBone, pair.subjectRest, world, measured);
        deltaFromRest(pair.referenceBone, pair.referenceRest, world, expected);
        const degrees =
          2 * Math.acos(Math.min(1, Math.abs(measured.dot(expected)))) * MathUtils.RAD2DEG;
        pair.sum += degrees;
        if (degrees > pair.max) {
          pair.max = degrees;
          pair.at = subjectTime;
        }
      }
    }
  } finally {
    subjectMixer.stopAllAction();
    referenceMixer.stopAllAction();
    subjectMixer.uncacheRoot(subject.root);
    referenceMixer.uncacheRoot(reference.root);
    restoreTransforms(subject.root, subjectSnapshot);
    restoreTransforms(reference.root, referenceSnapshot);
  }

  const bones: IBonePoseError[] = pairs
    .map((pair) => ({
      bone: pair.bone,
      reference: pair.reference,
      meanDegrees: pair.sum / samples,
      maxDegrees: pair.max,
      maxAtSeconds: pair.at,
    }))
    .sort((left, right) => right.meanDegrees - left.meanDegrees);
  return {
    clip: subject.clip.name,
    referenceClip: reference.clip.name,
    samples,
    meanDegrees: bones.reduce((sum, bone) => sum + bone.meanDegrees, 0) / bones.length,
    maxDegrees: bones.reduce((most, bone) => Math.max(most, bone.maxDegrees), 0),
    bones,
  };
}

function deltaFromRest(bone: Bone, rest: Quaternion, world: Quaternion, out: Quaternion): void {
  bone.getWorldQuaternion(world);
  out.copy(rest).invert().premultiply(world);
}

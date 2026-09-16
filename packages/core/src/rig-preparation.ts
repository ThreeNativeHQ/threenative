import type { AnimationClip, Object3D } from "three";

/**
 * Skeletal preparation reused across clones of one source rig.
 *
 * Creating a `SkeletalMesh3D` from the same source and clip set performs two per-instance
 * measurements: a property-binding audit for every required clip, and a full-rig foot-plant
 * sample the first time an in-place clip's ground speed is read. Both are properties of the
 * source rig and the clip, not of the instance, so a party of identical characters pays for
 * them once per member and sees nothing for it.
 *
 * This caches the two derived numbers only — never mixers, actions, bones, poses or the public
 * `.stride` report. Ownership hangs off the source object in a `WeakMap`, so a discarded source
 * releases its cache, and each number is guarded by a content signature: a changed hierarchy,
 * binding path, track value or clip duration is a different signature and a miss. A clone whose
 * own bind pose was edited before it is measured is likewise not eligible, which keeps one
 * clone's mutation from poisoning another's value.
 *
 * The unguarded per-instance path is the fallback for anything that cannot be represented safely:
 * ambiguous node names, non-bone tracks, a clip that does not drive every node, or a rig under a
 * non-uniform or tilted world transform.
 */

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;
/** The absolute scale difference within which a rig counts as uniformly scaled. */
const UNIFORM_SCALE_EPSILON = 1e-4;
/** Off-axis contribution within which a world matrix counts as yaw-only. */
const YAW_EPSILON = 1e-4;

/** A stride measured at unit world scale, so uniformly scaled clones can share it. */
export interface ISharedStride {
  /** Metres of ground per clip-second at rate 1, per unit of uniform world scale. */
  readonly groundSpeed: number;
  readonly inPlace: boolean;
}

interface IBindingEntry {
  readonly signature: string;
  readonly bound: number;
}

interface IStrideEntry {
  readonly signature: string;
  readonly stride: ISharedStride;
}

const floatBits = new Float64Array(1);
const floatWords = new Uint32Array(floatBits.buffer);

function hashString(hash: number, value: string): number {
  let result = hash;
  for (let index = 0; index < value.length; index += 1) {
    result = Math.imul(result ^ value.charCodeAt(index), FNV_PRIME);
  }
  return result;
}

function hashFloat(hash: number, value: number): number {
  floatBits[0] = value;
  const low = floatWords[0] ?? 0;
  const high = floatWords[1] ?? 0;
  return Math.imul(Math.imul(hash ^ low, FNV_PRIME) ^ high, FNV_PRIME);
}

function signatureOf(hash: number): string {
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** The node part of an ordinary bone-transform track, or `undefined` for any other track. */
function ordinaryTrackNode(track: string): string | undefined {
  for (const property of [".position", ".quaternion", ".scale"]) {
    if (track.endsWith(property)) {
      const node = track.slice(0, track.length - property.length);
      return node.length === 0 ? undefined : node;
    }
  }
  return undefined;
}

/**
 * True when every descendant node is uniquely named and every track is an ordinary
 * bone-transform track on a named node. Ambiguous names, `.morphTargetInfluences` or material
 * and custom property tracks are outside what sharing can represent safely.
 */
function ordinaryRig(source: Object3D, clips: readonly AnimationClip[]): boolean {
  const names = new Set<string>();
  let duplicate = false;
  source.traverse((object) => {
    if (object === source) return;
    if (object.name.length === 0) return;
    if (names.has(object.name)) duplicate = true;
    names.add(object.name);
  });
  if (duplicate) return false;
  for (const clip of clips) {
    for (const track of clip.tracks) {
      if (ordinaryTrackNode(track.name) === undefined) return false;
    }
  }
  return true;
}

/**
 * A clip drives every bone when each bone name appears as a track target.
 *
 * The sample starts from the rig's current pose and overwrites the nodes the clip drives, so an
 * untracked *bone* carries whatever the previous clip left it in — the one input that differs
 * between two clones. Untracked mesh or prop nodes keep a static local transform, which the
 * source clone gave every instance, so they do not disqualify reuse.
 */
function drivesEveryBone(source: Object3D, clip: AnimationClip): boolean {
  const needed = new Set<string>();
  source.traverse((object) => {
    if (object !== source && (object as { isBone?: boolean }).isBone === true)
      needed.add(object.name);
  });
  if (needed.size === 0) return false;
  for (const track of clip.tracks) {
    const node = ordinaryTrackNode(track.name);
    if (node !== undefined) needed.delete(node);
  }
  return needed.size === 0;
}

/** Binding resolves by node name, so only names and track targets can change the audit. */
function bindingSignature(source: Object3D, clip: AnimationClip): string | undefined {
  let hash = FNV_OFFSET;
  source.traverse((object) => {
    if (object === source) return;
    hash = hashString(hash, object.name);
    hash = hashString(hash, object.type);
  });
  for (const track of clip.tracks) hash = hashString(hash, track.name);
  return signatureOf(hash);
}

/**
 * The stride sample starts from the rig's current pose and overwrites only the nodes the clip
 * drives, so sharing requires full coverage; then only the clip's content matters. Duration and
 * values are hashed, not the track object, so an in-place edit is a different signature.
 */
function strideSignature(source: Object3D, clip: AnimationClip): string | undefined {
  if (!drivesEveryBone(source, clip)) return undefined;
  let hash = FNV_OFFSET;
  hash = hashString(hash, clip.name);
  hash = hashFloat(hash, clip.duration);
  const driven = new Set<string>();
  for (const track of clip.tracks) {
    const node = ordinaryTrackNode(track.name);
    if (node !== undefined) driven.add(node);
    hash = hashString(hash, track.name);
    const values = track.values;
    hash = hashFloat(hash, values.length);
    for (let index = 0; index < values.length; index += 1) {
      hash = hashFloat(hash, values[index] ?? 0);
    }
  }
  // An untracked mesh or prop starts from the pose its clone arrived with, so its local transform
  // is an input the sampled result depends on. Hashing it makes a mutated prop a miss. The rig
  // root's own transform is left out: translation, yaw and uniform scale are normalized out and
  // checked separately by `uniformYawScale`.
  source.traverse((object) => {
    if (object === source) return;
    if ((object as { isBone?: boolean }).isBone === true) return;
    if (object.name.length > 0 && driven.has(object.name)) return;
    hash = hashString(hash, object.name);
    hash = hashFloat(hash, object.position.x);
    hash = hashFloat(hash, object.position.y);
    hash = hashFloat(hash, object.position.z);
    hash = hashFloat(hash, object.quaternion.x);
    hash = hashFloat(hash, object.quaternion.y);
    hash = hashFloat(hash, object.quaternion.z);
    hash = hashFloat(hash, object.quaternion.w);
    hash = hashFloat(hash, object.scale.x);
    hash = hashFloat(hash, object.scale.y);
    hash = hashFloat(hash, object.scale.z);
  });
  return signatureOf(hash);
}

/**
 * The uniform world scale of a yaw-only, untilted transform, or `undefined` when the transform
 * carries a tilt, a mirror or a non-uniform scale that the normalized value cannot represent.
 */
export function uniformYawScale(matrixWorld: {
  readonly elements: ArrayLike<number>;
}): number | undefined {
  const e = matrixWorld.elements;
  const e0 = e[0] ?? 0;
  const e1 = e[1] ?? 0;
  const e2 = e[2] ?? 0;
  const e4 = e[4] ?? 0;
  const e5 = e[5] ?? 0;
  const e6 = e[6] ?? 0;
  const e8 = e[8] ?? 0;
  const e9 = e[9] ?? 0;
  const e10 = e[10] ?? 0;
  const scaleX = Math.hypot(e0, e1, e2);
  const scaleY = Math.hypot(e4, e5, e6);
  const scaleZ = Math.hypot(e8, e9, e10);
  if (!(scaleX > 0) || !(scaleY > 0) || !(scaleZ > 0)) return undefined;
  if (
    Math.abs(scaleX - scaleY) > UNIFORM_SCALE_EPSILON ||
    Math.abs(scaleY - scaleZ) > UNIFORM_SCALE_EPSILON
  ) {
    return undefined;
  }
  // A yaw-only rotation leaves the Y axis vertical and keeps both horizontal axes level.
  const upY = e5 / scaleY;
  if (
    Math.abs(e1 / scaleX) > YAW_EPSILON ||
    Math.abs(e9 / scaleZ) > YAW_EPSILON ||
    Math.abs(e4 / scaleY) > YAW_EPSILON ||
    Math.abs(e6 / scaleY) > YAW_EPSILON ||
    Math.abs(Math.abs(upY) - 1) > YAW_EPSILON
  ) {
    return undefined;
  }
  const determinant =
    e0 * (e5 * e10 - e6 * e9) - e1 * (e4 * e10 - e6 * e8) + e2 * (e4 * e9 - e5 * e8);
  if (!(determinant > 0)) return undefined;
  return (scaleX + scaleY + scaleZ) / 3;
}

export class RigPreparation {
  readonly #binding = new Map<AnimationClip, IBindingEntry>();
  readonly #stride = new Map<AnimationClip, IStrideEntry>();

  /** The cached binding count for an equivalent preparation, or `undefined` on a miss. */
  boundCount(source: Object3D, clip: AnimationClip): number | undefined {
    const entry = this.#binding.get(clip);
    if (entry === undefined) return undefined;
    if (!ordinaryRig(source, [clip])) return undefined;
    const signature = bindingSignature(source, clip);
    return signature !== undefined && signature === entry.signature ? entry.bound : undefined;
  }

  rememberBound(source: Object3D, clip: AnimationClip, bound: number): void {
    if (!ordinaryRig(source, [clip])) return;
    const signature = bindingSignature(source, clip);
    if (signature !== undefined) this.#binding.set(clip, { signature, bound });
  }

  /** The cached unit-scale stride for an equivalent, fully covered clip, or `undefined`. */
  stride(source: Object3D, clip: AnimationClip): ISharedStride | undefined {
    const entry = this.#stride.get(clip);
    if (entry === undefined) return undefined;
    if (!ordinaryRig(source, [clip])) return undefined;
    const signature = strideSignature(source, clip);
    return signature !== undefined && signature === entry.signature ? entry.stride : undefined;
  }

  rememberStride(source: Object3D, clip: AnimationClip, stride: ISharedStride): void {
    if (!ordinaryRig(source, [clip])) return;
    const signature = strideSignature(source, clip);
    if (signature !== undefined) this.#stride.set(clip, { signature, stride });
  }
}

const preparations = new WeakMap<Object3D, RigPreparation>();

/** The preparation cache owned by a source rig, created on first clone. */
export function rigPreparation(source: Object3D): RigPreparation {
  let preparation = preparations.get(source);
  if (preparation === undefined) {
    preparation = new RigPreparation();
    preparations.set(source, preparation);
  }
  return preparation;
}

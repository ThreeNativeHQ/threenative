import { type Bone, type Object3D, Vector3 } from "three";
import { bonesIn } from "./skeleton.js";

/**
 * One rig's parent→child bone distances, captured at one moment.
 *
 * A rigid skeleton preserves every parent→child distance under any pose — that is what makes
 * bone length the one number that names a broken pose without a screenshot (PRD-324).
 */
export interface IBoneLengthSnapshot {
  readonly bones: number;
  /** Bone name → world distance to its parent bone, in metres. Bones without a bone parent are absent. */
  readonly lengths: Readonly<Record<string, number>>;
}

/** One bone whose parent→child distance changed between the snapshot and now. */
export interface IBoneLengthDeviation {
  readonly bone: string;
  /** The distance at the snapshot, in metres. */
  readonly bindLength: number;
  /** The distance now, in metres. */
  readonly posedLength: number;
  /** `posedLength / bindLength`; `Infinity` when the bind distance was zero. */
  readonly ratio: number;
  /** `|posedLength − bindLength|`, in metres. */
  readonly delta: number;
}

export interface IBoneLengthDeviationReport {
  readonly bones: number;
  /** Bones actually compared: named in both the snapshot and now. */
  readonly compared: number;
  /** The largest relative change across compared bones. Zero for a rigid pose. */
  readonly maxDeviation: number;
  /** The worst deviating bone, or `null` when the pose is rigid. */
  readonly worst: IBoneLengthDeviation | null;
  /** Every bone past `tolerance`, worst first. */
  readonly deviations: readonly IBoneLengthDeviation[];
  /** True when no bone moved past `tolerance` relative to its bind distance. */
  readonly rigid: boolean;
}

export interface IBoneLengthDeviationsOptions {
  /**
   * Allowed relative change per bone before it is named. Default `0.01` — one per cent of its
   * own bind length, which float noise sits far below and a pose defect sits far above.
   */
  readonly tolerance?: number;
}

/** Relative changes below this are float noise even for the shortest bone. */
const ABSOLUTE_FLOOR = 1e-9;

function boneLengthsOf(root: Object3D): Map<string, number> {
  const bones = bonesIn(root);
  if (bones.length === 0) {
    throw new Error(`boneLengths: '${root.name || root.type}' has no bones.`);
  }
  root.updateMatrixWorld(true);
  const withBoneParent = new Set<Bone>();
  for (const bone of bones) {
    if (bone.parent !== null && (bone.parent as Bone).isBone === true) withBoneParent.add(bone);
  }
  const lengths = new Map<string, number>();
  const child = new Vector3();
  const parent = new Vector3();
  for (const bone of withBoneParent) {
    child.setFromMatrixPosition(bone.matrixWorld);
    parent.setFromMatrixPosition((bone.parent as Bone).matrixWorld);
    lengths.set(bone.name, child.distanceTo(parent));
  }
  return lengths;
}

/**
 * Measure every parent→child bone distance, in world space, as the rig stands right now.
 *
 * World distances, so a uniform ancestor scale is part of the number: capture the baseline and
 * the comparison under the same ancestor transform (in the usual shape, both after the rig's
 * normalisation) and the scale cancels in the comparison.
 */
export function boneLengths(root: Object3D): IBoneLengthSnapshot {
  const lengths = boneLengthsOf(root);
  return {
    bones: bonesIn(root).length,
    lengths: Object.fromEntries(lengths),
  };
}

/**
 * Compare a rig's parent→child bone distances now against a captured snapshot.
 *
 * A rigid skeleton preserves every parent→child distance under any pose, so any named bone is
 * a defect with an address: something moved a bone away from its parent — a position or scale
 * track in the wrong space, a bind mismatch, a clipped hierarchy — and no screenshot needs to
 * be squinted at to say which one (PRD-324).
 */
export function boneLengthDeviations(
  root: Object3D,
  bind: IBoneLengthSnapshot,
  options: IBoneLengthDeviationsOptions = {},
): IBoneLengthDeviationReport {
  const tolerance = options.tolerance ?? 0.01;
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error(
      `boneLengthDeviations: tolerance must be a finite non-negative number, received ${tolerance}.`,
    );
  }
  root.updateMatrixWorld(true);
  const now = boneLengthsOf(root);

  const bones = bonesIn(root).length;
  const deviations: IBoneLengthDeviation[] = [];
  let compared = 0;
  let maxDeviation = 0;
  for (const [bone, posedLength] of now) {
    const bindLength = bind.lengths[bone];
    if (bindLength === undefined) {
      throw new Error(
        `boneLengthDeviations: bone '${bone}' has no snapshot length; capture the baseline from the same rig.`,
      );
    }
    compared += 1;
    const delta = Math.abs(posedLength - bindLength);
    const relative = Math.max(delta / Math.max(bindLength, ABSOLUTE_FLOOR), delta);
    maxDeviation = Math.max(maxDeviation, relative);
    if (relative > tolerance) {
      deviations.push({
        bone,
        bindLength,
        posedLength,
        ratio: bindLength > 0 ? posedLength / bindLength : Number.POSITIVE_INFINITY,
        delta,
      });
    }
  }
  for (const bone of Object.keys(bind.lengths)) {
    if (!now.has(bone)) {
      throw new Error(
        `boneLengthDeviations: snapshot bone '${bone}' is not under the root any more; capture the baseline from the same rig.`,
      );
    }
  }
  deviations.sort((left, right) => {
    const leftRelative = left.delta / Math.max(left.bindLength, ABSOLUTE_FLOOR);
    const rightRelative = right.delta / Math.max(right.bindLength, ABSOLUTE_FLOOR);
    return rightRelative - leftRelative;
  });
  return {
    bones,
    compared,
    maxDeviation,
    worst: deviations[0] ?? null,
    deviations,
    rigid: deviations.length === 0,
  };
}

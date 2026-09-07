import type { AnimationClip, Object3D } from "three";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { AnimationPlayer } from "./animation.js";
import { clipTrackBindings } from "./clip-audit.js";
import { type INormaliseToMetresOptions, normaliseToMetres } from "./scale.js";

export interface ISkeletalMesh3DOptions {
  readonly source: Object3D;
  readonly clips?: readonly AnimationClip[];
  readonly requiredClips?: readonly string[] | Readonly<Record<string, string>>;
  readonly size?: INormaliseToMetresOptions;
  readonly strideRoot?: Object3D;
  readonly strideSync?: boolean;
}

/** Skeleton-safe, measured preparation that is also the rig's AnimationPlayer. */
export class SkeletalMesh3D extends AnimationPlayer {
  readonly root: Object3D;
  readonly scaleFactor: number;

  constructor(options: ISkeletalMesh3DOptions) {
    if (!options?.source) throw new Error("SkeletalMesh3D requires a source Object3D.");
    const root = cloneSkeleton(options.source);
    const clips = options.clips ?? [];
    validateRequiredClips(root, clips, options.requiredClips);
    super({ clips, root, strideRoot: options.strideRoot ?? root, strideSync: options.strideSync });
    this.root = root;
    this.scaleFactor = options.size === undefined ? 1 : normaliseToMetres(root, options.size);
  }
}

function validateRequiredClips(
  root: Object3D,
  clips: readonly AnimationClip[],
  requiredClips: unknown,
): void {
  if (requiredClips === undefined) return;
  const names = requiredClipNames(requiredClips);
  const available = new Map(clips.map((clip) => [clip.name, clip]));
  for (const name of names) {
    const clip = available.get(name);
    if (clip === undefined) {
      const listed = clips.map((item) => `'${item.name}'`).join(", ") || "(none)";
      throw new Error(
        `SkeletalMesh3D: missing required clip '${name}'. Available clips: ${listed}.`,
      );
    }
    if (clipTrackBindings(root, clip).bound === 0)
      throw new Error(
        `SkeletalMesh3D: clip '${name}' binds 0 tracks to '${root.name || root.type}'.`,
      );
  }
}

function requiredClipNames(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : value !== null && typeof value === "object"
      ? Object.values(value)
      : undefined;
  if (values === undefined)
    throw new Error("SkeletalMesh3D: requiredClips must be an array or string-valued dictionary.");
  return values.map((name, index) => {
    if (typeof name !== "string" || name.length === 0)
      throw new Error(`SkeletalMesh3D: requiredClips['${index}'] must be a non-empty string.`);
    return name;
  });
}

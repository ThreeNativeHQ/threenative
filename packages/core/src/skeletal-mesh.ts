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

export class SkeletalMesh3D extends AnimationPlayer {
  readonly root: Object3D;
  readonly scaleFactor: number;

  constructor(options: ISkeletalMesh3DOptions) {
    if (!options?.source) throw new Error("SkeletalMesh3D requires a source Object3D.");
    const root = cloneSkeleton(options.source);
    const clips = options.clips ?? [];
    for (const name of requiredClipNames(options.requiredClips)) {
      const clip = clips.find((item) => item.name === name);
      if (clip === undefined)
        throw new Error(
          `SkeletalMesh3D: missing required clip '${name}'. Available clips: ${clips.map((item) => `'${item.name}'`).join(", ") || "(none)"}.`,
        );
      if (clipTrackBindings(root, clip).bound === 0)
        throw new Error(
          `SkeletalMesh3D: clip '${name}' binds 0 tracks to '${root.name || root.type}'.`,
        );
    }
    super({ clips, root, strideRoot: options.strideRoot ?? root, strideSync: options.strideSync });
    this.root = root;
    this.scaleFactor = options.size === undefined ? 1 : normaliseToMetres(root, options.size);
  }
}

function requiredClipNames(value: ISkeletalMesh3DOptions["requiredClips"]): readonly string[] {
  if (value === undefined) return [];
  const names = Array.isArray(value) ? value : Object.values(value);
  if (!names.every((name): name is string => typeof name === "string" && name.length > 0))
    throw new Error("SkeletalMesh3D: requiredClips must contain non-empty strings.");
  return names;
}

import type { AnimationClip, Object3D } from "three";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { AnimationPlayer, type IAnimationPlayOptions, type IStrideReport } from "./animation.js";
import { clipTrackBindings } from "./clip-audit.js";
import { type INormaliseToMetresOptions, normaliseToMetres } from "./scale.js";

export interface ISkeletalMesh3DOptions {
  /** The source rig (e.g. gltf.scene) to clone skeleton-safely for this instance. */
  readonly source: Object3D;
  /** Available animation clips for this character. */
  readonly clips?: readonly AnimationClip[];
  /**
   * Clips required by name, array, or dictionary.
   *
   * If any requested clip is missing from `clips` or binds 0 tracks to the rig,
   * preparation throws an Error at load time.
   */
  readonly requiredClips?: readonly string[] | Readonly<Record<string, string>> | object;
  /**
   * Normalise the instance to real-world metres via `normaliseToMetres`.
   */
  readonly size?: INormaliseToMetresOptions;
  /**
   * The object whose travel counts as ground covered for stride sync. Defaults to `this.root`.
   *
   * Name the parent body a game moves when the rig is a child of it, so measuring the body
   * does not read the clip's own root motion back.
   */
  readonly strideRoot?: Object3D;
  /**
   * Match a travelling clip's playback rate to ground covered. Defaults to true.
   */
  readonly strideSync?: boolean;
}

/**
 * Shared preparation for an imported rigged character.
 *
 * Instances the rig with a skeleton-safe clone, normalises size with skin-aware measurement,
 * validates requested clips against the file and rig at load time, and sets up AnimationPlayer
 * with honest stride-root accounting.
 */
export class SkeletalMesh3D {
  /** The skeleton-safely cloned rig instance. */
  readonly root: Object3D;
  /** The animation player driving this rig. */
  readonly player: AnimationPlayer;
  /** The scale factor applied if `size` was provided, or 1. */
  readonly scaleFactor: number;

  constructor(options: ISkeletalMesh3DOptions) {
    if (!options.source) {
      throw new Error("SkeletalMesh3D requires a source Object3D.");
    }

    this.root = cloneSkeleton(options.source);

    if (options.size !== undefined) {
      this.scaleFactor = normaliseToMetres(this.root, options.size);
    } else {
      this.scaleFactor = 1;
    }

    const availableClips = options.clips ?? [];
    if (options.requiredClips !== undefined) {
      const required: string[] = Array.isArray(options.requiredClips)
        ? options.requiredClips
        : Object.values(options.requiredClips).filter(
            (value): value is string => typeof value === "string",
          );
      const clipMap = new Map<string, AnimationClip>(
        availableClips.map((clip) => [clip.name, clip]),
      );
      for (const clipName of required) {
        const clip = clipMap.get(clipName);
        if (clip === undefined) {
          const available = availableClips.map((c) => `'${c.name}'`).join(", ") || "(none)";
          throw new Error(
            `SkeletalMesh3D: missing required clip '${clipName}'. Available clips: ${available}.`,
          );
        }
        const report = clipTrackBindings(this.root, clip);
        if (report.bound === 0) {
          throw new Error(
            `SkeletalMesh3D: clip '${clipName}' binds 0 tracks to '${this.root.name || this.root.type}'.`,
          );
        }
      }
    }

    this.player = new AnimationPlayer({
      clips: availableClips,
      root: this.root,
      strideRoot: options.strideRoot ?? this.root,
      strideSync: options.strideSync,
    });
  }

  get current(): string | undefined {
    return this.player.current;
  }

  get stride(): IStrideReport {
    return this.player.stride;
  }

  play(name: string, playOptions?: IAnimationPlayOptions): void {
    this.player.play(name, playOptions);
  }

  update(dt: number): void {
    this.player.update(dt);
  }

  stop(): void {
    this.player.stop();
  }

  dispose(): void {
    this.player.dispose();
  }
}

/**
 * Prepare a rigged character with skeleton-safe cloning, size normalisation, and clip audit.
 */
export function prepareSkeletalMesh(options: ISkeletalMesh3DOptions): SkeletalMesh3D {
  return new SkeletalMesh3D(options);
}

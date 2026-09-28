// PRD-464 R3's characters, built with the engine's own path: `createAssetLoader().model()` for the
// bytes and `SkeletalMesh3D` — the `AnimationPlayer` subclass that clones a rig safely — for the
// 50 instances. This module is imported by the ThreeNative arms only, never by `plain.ts`, so the
// control arm's served graph still contains no framework code.
import type { AnimationClip } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createAssetLoader } from "../../../packages/core/src/assets.js";
import { SkeletalMesh3D } from "../../../packages/core/src/skeletal-mesh.js";
import type { ICharacterCrowd } from "./game.js";
import { LADDER_CHARACTERS, LADDER_CLIP, characterStagger } from "./ladder.js";
// Inlined by the `tn-bench-fox-glb` plugin in `vite.config.ts` from the copy pinned in
// `benchmark/engine-load-test/sources.lock.json`, hash-checked at build time.
import foxGlb from "virtual:fox-glb";

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function createFoxCrowd(): Promise<ICharacterCrowd> {
  // The engine's loader, with the source injected: one file, already in memory, and the same call a
  // game would make. A scene that decoded the model itself would be measuring a path no ThreeNative
  // game takes.
  const bytes = decodeBase64(foxGlb);
  const source = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const gltf = await createAssetLoader({
    model: () =>
      new Promise((resolve, reject) => {
        new GLTFLoader().parse(source, "", resolve, reject);
      }),
  }).model<{ animations: AnimationClip[]; scene: object }>("fox/Fox.glb");
  const clip = gltf.animations.find((animation) => animation.name === LADDER_CLIP);
  if (clip === undefined)
    throw new Error("TN_BENCH_FOX_CLIP_MISSING");
  const clipSeconds = clip.duration;
  const players: SkeletalMesh3D[] = [];
  const staggers: number[] = [];
  for (let index = 0; index < LADDER_CHARACTERS; index += 1) {
    // `requiredClips` fails closed at load time if the rig cannot play the clip, so a fox that
    // loads but binds nothing cannot become 50 silently frozen meshes.
    const character = new SkeletalMesh3D({
      clips: [clip],
      requiredClips: [LADDER_CLIP],
      source: gltf.scene as never,
      strideSync: false,
    });
    character.play(LADDER_CLIP);
    players.push(character);
    staggers.push(characterStagger(index, clipSeconds));
  }
  return {
    skinnedMeshes: players.length,
    dispose: () => {
      for (const character of players) character.dispose();
    },
    objects: () => players.map((character) => character.root),
    // The pose is an absolute function of the frame index plus this character's own phase, never of
    // elapsed time — the same discipline `cameraPose` and the point-light orbit follow, so a slow
    // arm and a fast arm draw the same 50 poses at frame 317.
    step: (frameIndex: number) => {
      for (let index = 0; index < players.length; index += 1) {
        (players[index] as SkeletalMesh3D).mixer.setTime(
          (staggers[index] as number) + frameIndex / 60,
        );
      }
    },
  };
}

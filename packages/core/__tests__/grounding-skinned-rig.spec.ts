import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AnimationClip, Object3D } from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import { GroundSnap } from "../src/grounding.js";
import { measureThreePose, posedBounds } from "../src/pose-measure.js";
import { normaliseToMetres } from "../src/scale.js";
import { SkeletalMesh3D } from "../src/skeletal-mesh.js";

const MANNEQUIN = fileURLToPath(
  new URL("../../create-threenative/template-assets/assets/mannequin.glb", import.meta.url),
);

async function loadMannequin(): Promise<{ scene: Object3D; animations: AnimationClip[] }> {
  const bytes = readFileSync(MANNEQUIN);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  await MeshoptDecoder.ready;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return new Promise((resolve, reject) => loader.parse(buffer, "", resolve, reject));
}

// The templates' shipped mannequin (Quaternius UAL, Unreal-style skeleton), set up exactly the way
// minimal and starter do: SkeletalMesh3D, normalised to its Head joint, feet sunk to the capsule.
describe("GroundSnap on the shipped skinned mannequin", () => {
  it("measures the posed feet where the skin actually is", async () => {
    const gltf = await loadMannequin();
    const character = new SkeletalMesh3D({
      source: gltf.scene,
      clips: gltf.animations,
      requiredClips: ["Idle_Loop", "Jog_Fwd_Loop"],
    });
    const figure = character.root;
    normaliseToMetres(figure, { axis: "height", metres: 1.545 });
    const snap = new GroundSnap(figure, { enabled: false });
    // The templates ground before the first animation update, so the envelope is first measured
    // in whatever pose the rig loads in — that order is what the game runs.
    snap.apply(figure, 0, 1 / 30);
    for (const clip of ["Idle_Loop", "Jog_Fwd_Loop"]) {
      character.play(clip);
      for (let step = 0; step < 20; step += 1) {
        character.update(1 / 30);
        snap.apply(figure, 0, 1 / 30);
        const envelope = posedBounds(figure).min[1];
        const skin = measureThreePose(figure).bounds?.min[1] ?? Number.NaN;
        expect(Math.abs(envelope - skin), `${clip} step ${step}`).toBeLessThan(0.04);
      }
    }
  });

  // Seen in the running starter: a frame rendered the figure, then the player was placed (raised
  // to its capsule, turned to face the level) and GroundSnap calibrated. SkinnedMesh refreshes its
  // bindMatrixInverse only in updateMatrixWorld — the renderer's call — not in updateWorldMatrix,
  // so the skin was measured at the figure's old transform: a finger got a 3.8 m sphere and every
  // later frame snapped the figure 0.66 m into the air while its own clearance read zero.
  it("calibrates against the skin where it is now, not where the last render left it", async () => {
    const gltf = await loadMannequin();
    const character = new SkeletalMesh3D({
      source: gltf.scene,
      clips: gltf.animations,
      requiredClips: ["Idle_Loop"],
    });
    const figure = character.root;
    normaliseToMetres(figure, { axis: "height", metres: 1.545 });
    figure.updateMatrixWorld(true); // a frame renders the figure where it was built
    figure.position.set(-2, 0.9, 0); // then the player is placed…
    figure.rotation.y = Math.PI; // …and turned to face the level
    const snap = new GroundSnap(figure, { enabled: false });
    snap.apply(figure, 0, 1 / 30);
    character.play("Idle_Loop");
    for (let step = 0; step < 30; step += 1) {
      character.update(1 / 30);
      figure.updateMatrixWorld(true); // the render each frame
      const envelope = posedBounds(figure).min[1];
      const skin = measureThreePose(figure).bounds?.min[1] ?? Number.NaN;
      expect(Math.abs(envelope - skin), `step ${step}`).toBeLessThan(0.04);
    }
  });
});

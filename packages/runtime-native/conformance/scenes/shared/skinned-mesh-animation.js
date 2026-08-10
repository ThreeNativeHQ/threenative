import { assertCondition, startVisualScene, THREE } from "./scene-support.js";
import { playClipAt } from "./planned-animation-support.js";

export function createSkinnedMeshAnimationProof() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-0.52, -0.8, 0, 0.52, -0.8, 0, -0.52, 0.8, 0, 0.52, 0.8, 0], 3),
  );
  geometry.setAttribute(
    "skinIndex",
    new THREE.Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4),
  );
  geometry.setAttribute(
    "skinWeight",
    new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4),
  );
  geometry.setIndex([0, 1, 2, 2, 1, 3]);
  geometry.computeVertexNormals();

  const mesh = new THREE.SkinnedMesh(
    geometry,
    new THREE.MeshBasicMaterial({ color: 0x64dfdf, side: THREE.DoubleSide }),
  );
  const rootBone = new THREE.Bone();
  rootBone.name = "Root";
  const tipBone = new THREE.Bone();
  tipBone.name = "Tip";
  rootBone.add(tipBone);
  mesh.add(rootBone);
  mesh.bind(new THREE.Skeleton([rootBone, tipBone]));

  const clip = new THREE.AnimationClip("bone-bend", 1, [
    new THREE.NumberKeyframeTrack("Tip.rotation[z]", [0, 1], [0, Math.PI / 3]),
  ]);
  const { mixer, action } = playClipAt(mesh, clip, 0.5);
  assertCondition(mesh.isSkinnedMesh === true, "animation subject must be an upstream SkinnedMesh");
  assertCondition(mesh.skeleton.bones.length === 2, "SkinnedMesh must bind both bones");
  assertCondition(
    geometry.getAttribute("skinIndex")?.count === 4 &&
      geometry.getAttribute("skinWeight")?.count === 4,
    "SkinnedMesh must carry skin indices and weights",
  );
  assertCondition(
    Math.abs(tipBone.rotation.z - Math.PI / 6) < 1e-6,
    "AnimationMixer must evaluate the bone rotation track",
  );
  return { mesh, rootBone, tipBone, clip, mixer, action };
}

export function startScene(canvas, dimensions) {
  const proof = createSkinnedMeshAnimationProof();
  return startVisualScene(canvas, dimensions, "skinned-mesh-animation", ({ scene }) => {
    scene.add(proof.mesh);
    return {
      ...proof,
      detail: {
        clip: proof.clip.name,
        bones: proof.mesh.skeleton.bones.length,
        tipRotation: proof.tipBone.rotation.z,
      },
    };
  });
}

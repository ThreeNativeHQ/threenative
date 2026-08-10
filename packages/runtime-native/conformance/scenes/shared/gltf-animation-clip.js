import { assertCondition, startVisualScene } from "./scene-support.js";
import { loadAnimatedGltf, playClipAt, THREE } from "./planned-animation-support.js";

export async function startScene(canvas, dimensions) {
  const { gltf, clip, animatedRoot } = await loadAnimatedGltf();
  const marker = new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.38, 0.12, 48, 8),
    new THREE.MeshBasicMaterial({ color: 0xffb347 }),
  );
  animatedRoot.add(marker);
  const { mixer } = playClipAt(gltf.scene, clip, 0.5);
  assertCondition(
    Math.abs(animatedRoot.position.x) < 1e-6 && Math.abs(animatedRoot.position.y - 0.075) < 1e-6,
    "AnimationMixer must evaluate the glTF translation clip at 0.5 seconds",
  );
  return startVisualScene(canvas, dimensions, "gltf-animation-clip", ({ scene }) => {
    scene.add(gltf.scene);
    return {
      detail: { clip: clip.name, duration: clip.duration, evaluatedSeconds: mixer.time },
      animatedRoot,
      marker,
      mixer,
    };
  });
}

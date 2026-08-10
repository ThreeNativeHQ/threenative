import { assertCondition, startVisualScene, THREE } from "./scene-support.js";
import { playClipAt } from "./planned-animation-support.js";

export function createMixerAnimationProof() {
  const subject = new THREE.Mesh(
    new THREE.BoxGeometry(1.45, 0.5, 0.42),
    new THREE.MeshBasicMaterial({ color: 0x8ac926 }),
  );
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 16, 10),
    new THREE.MeshBasicMaterial({ color: 0xffca3a }),
  );
  marker.position.x = 0.62;
  subject.add(marker);
  const track = new THREE.NumberKeyframeTrack(
    ".rotation[y]",
    [0, 1],
    [0, Math.PI],
  );
  const clip = new THREE.AnimationClip("half-turn", 1, [track]);
  const { mixer, action } = playClipAt(subject, clip, 0.5);
  assertCondition(
    Math.abs(subject.rotation.y - Math.PI / 2) < 1e-6,
    "AnimationMixer must evaluate a NumberKeyframeTrack on its root",
  );
  return { subject, marker, clip, mixer, action };
}

export function startScene(canvas, dimensions) {
  const proof = createMixerAnimationProof();
  return startVisualScene(canvas, dimensions, "mixer-animation", ({ scene }) => {
    scene.add(proof.subject);
    return {
      ...proof,
      detail: { clip: proof.clip.name, mixerTime: proof.mixer.time },
    };
  });
}

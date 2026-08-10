import { THREE, assertCondition, startVisualScene } from "./scene-support.js";

export function assertAnimatedShadowProof({ renderer, caster, floor, light, clip, before, after }) {
  assertCondition(renderer.shadowMap.enabled === true, "shadow map must be enabled");
  assertCondition(caster.castShadow === true, "animated object must cast a shadow");
  assertCondition(floor.receiveShadow === true, "floor must receive the animated shadow");
  assertCondition(light.castShadow === true, "light must cast shadows");
  assertCondition(
    clip.tracks.length === 1 && clip.duration === 1,
    "shadow animation clip mismatch",
  );
  assertCondition(Math.abs(after - before) > 0.5, "animation did not move the shadow caster");
}

export function startScene(canvas, dimensions) {
  return startVisualScene(canvas, dimensions, "animated-shadows", ({ renderer, scene, camera }) => {
    renderer.shadowMap.enabled = true;
    camera.position.set(2.7, 2.2, 4.1);
    camera.lookAt(0, -0.2, 0);

    const caster = new THREE.Mesh(
      new THREE.SphereGeometry(0.48, 28, 18),
      new THREE.MeshStandardMaterial({ color: 0xed8936, roughness: 0.55 }),
    );
    caster.position.set(-0.75, 0.2, 0);
    caster.castShadow = true;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 4),
      new THREE.MeshStandardMaterial({ color: 0x718096, roughness: 0.9 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.72;
    floor.receiveShadow = true;
    const light = new THREE.DirectionalLight(0xffffff, 3.5);
    light.position.set(-2.5, 4, 2.5);
    light.castShadow = true;

    const track = new THREE.NumberKeyframeTrack(".position[x]", [0, 1], [-0.75, 0.75]);
    const clip = new THREE.AnimationClip("move-shadow-caster", 1, [track]);
    const mixer = new THREE.AnimationMixer(caster);
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    const before = caster.position.x;
    mixer.setTime(0.75);
    const after = caster.position.x;
    assertAnimatedShadowProof({ renderer, caster, floor, light, clip, before, after });

    scene.add(caster, floor, light, new THREE.AmbientLight(0x405070, 0.4));
    return { caster, floor, light, mixer, detail: { before, after } };
  });
}

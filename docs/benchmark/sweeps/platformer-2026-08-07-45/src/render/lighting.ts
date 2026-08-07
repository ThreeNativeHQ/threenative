import {
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  PCFSoftShadowMap,
  type Scene,
} from "three";

type ShadowRenderer = { shadowMap: { enabled: boolean; type: number } };

export function setupLighting(scene: Scene, renderer: ShadowRenderer): void {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  scene.add(new HemisphereLight(0x8edcff, 0x1b3a48, 1.35));

  const key = new DirectionalLight(0xfff0c8, 3.2);
  key.position.set(4, 7, 3);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 60;
  key.shadow.bias = -0.0008;
  scene.add(key);

  const rim = new DirectionalLight(0x8fd0ff, 0.95);
  rim.position.set(-5, 3, -6);
  scene.add(rim);

  scene.add(new AmbientLight(0xffffff, 0.2));
}

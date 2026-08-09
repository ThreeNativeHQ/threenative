import { AmbientLight, DirectionalLight, HemisphereLight, PCFSoftShadowMap, type Scene, Vector3 } from "three";
import { palette } from "./palette.js";

type ShadowRenderer = { shadowMap: { enabled: boolean; type: number } };

export function setupLighting(scene: Scene, renderer: ShadowRenderer) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  scene.add(new HemisphereLight(palette.skyHigh, 0x425e2e, 1.5));
  scene.add(new AmbientLight(0xb2c4a3, 0.24));

  const sun = new DirectionalLight(palette.sun, 2.75);
  sun.position.set(-45, 85, 70);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 240;
  sun.shadow.camera.left = -72;
  sun.shadow.camera.right = 72;
  sun.shadow.camera.top = 72;
  sun.shadow.camera.bottom = -72;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  return {
    follow(position: Vector3) {
      sun.position.set(position.x - 45, position.y + 85, position.z + 70);
      sun.target.position.set(position.x + 12, position.y, position.z);
      sun.target.updateMatrixWorld();
    },
  };
}

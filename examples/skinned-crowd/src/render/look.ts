import {
  DirectionalLight,
  HemisphereLight,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  type Scene,
} from "three";

type ShadowRenderer = { shadowMap: { enabled: boolean; type: number } };

/** Everything the crowd looks like: one sun with shadows, a sky fill, and two surfaces. */
export function crowdLook(scene: Scene, renderer: ShadowRenderer, extent: number) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  scene.add(new HemisphereLight(0xdfefff, 0x3a3226, 1.2));
  const sun = new DirectionalLight(0xfff1dc, 2.4);
  sun.position.set(6, 14, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -extent;
  sun.shadow.camera.right = sun.shadow.camera.top = extent;
  scene.add(sun);
  return {
    skin: new MeshStandardMaterial({ color: 0xc27d52, roughness: 0.6 }),
    ground: new MeshStandardMaterial({ color: 0x6f7c5a, roughness: 0.95 }),
  };
}

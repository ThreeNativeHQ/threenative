import { DirectionalLight, HemisphereLight, MeshStandardMaterial, type Scene } from "three";

/** Everything this rig looks like: a sun, a sky fill, and the two surfaces it is built from. */
export function gripLook(scene: Scene) {
  scene.add(new HemisphereLight(0xdfefff, 0x2c3038, 1.6));
  const sun = new DirectionalLight(0xfff1dc, 2.2);
  sun.position.set(2.5, 4, -3);
  scene.add(sun);
  return {
    body: new MeshStandardMaterial({ color: 0x8d9bb0, roughness: 0.55, metalness: 0.15 }),
    rifle: new MeshStandardMaterial({ color: 0x4b4238, roughness: 0.7, metalness: 0.35 }),
  };
}

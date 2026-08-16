// Ordinary Three.js. A dark vault lit by lanterns on the west wall and one
// cold shard over the goal pad, plus a soft overhead key so stacked crates read
// as separate boxes instead of one silhouette.
import {
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  PCFSoftShadowMap,
  PointLight,
  type Scene,
} from "three";
import { palette } from "./palette.js";

type ShadowRenderer = { shadowMap: { enabled: boolean; type: number } };

export function setupLighting(scene: Scene, renderer: ShadowRenderer): void {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  scene.add(new HemisphereLight(0x3d5480, 0x141c2c, 1.1));
  scene.add(new AmbientLight(0x2c3852, 1.3));

  // Key from high above the west wall, warm, and the only shadow caster: two
  // shadow maps in a room this small double the cost and read as mud.
  const key = new DirectionalLight(palette.accent, 3.4);
  key.position.set(-9, 16, 9);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 60;
  const extent = 16;
  key.shadow.camera.left = -extent;
  key.shadow.camera.right = extent;
  key.shadow.camera.top = extent;
  key.shadow.camera.bottom = -extent;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.02;
  scene.add(key);

  // Camera-side fill. Without it the faces turned toward the player go black
  // and every crate reads as a bright cage around a dark hole.
  const fill = new DirectionalLight(0xffe3c0, 1.15);
  fill.position.set(1, 6, 14);
  scene.add(fill);

  // Cool fill from the goal corner so the far side of every crate picks up cyan.
  const cool = new DirectionalLight(palette.goal, 1.1);
  cool.position.set(10, 6, -10);
  scene.add(cool);
}

/** One lantern flame: the glow quad is added by the room, this is just the light. */
export function lanternLight(x: number, y: number, z: number): PointLight {
  const light = new PointLight(palette.lantern, 34, 18, 2);
  light.position.set(x, y, z);
  return light;
}

export function goalLight(x: number, y: number, z: number): PointLight {
  const light = new PointLight(palette.goal, 30, 15, 2);
  light.position.set(x, y, z);
  return light;
}

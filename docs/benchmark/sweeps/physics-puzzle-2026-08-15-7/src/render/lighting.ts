// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// A dark vault lit by warm lanterns and one cold source. The temperature split
// is doing the work: everything the character can touch is warm, everything that
// glows cyan is either the goal or something the character passes through.
import {
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  PCFSoftShadowMap,
  PointLight,
  type Scene,
} from "three";
import { ROOM_HALF } from "../level/layout.js";
import { palette } from "./palette.js";

type ShadowRenderer = { shadowMap: { enabled: boolean; type: number } };

/** Where the wall lanterns hang. `room.ts` puts a fixture at each of these. */
export const LANTERNS: readonly { readonly x: number; readonly z: number }[] = [
  { x: -ROOM_HALF + 0.5, z: -2.4 },
  { x: -ROOM_HALF + 0.5, z: 3.6 },
  { x: 2.4, z: -ROOM_HALF + 0.5 },
];

export function setupLighting(scene: Scene, renderer: ShadowRenderer): void {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  scene.add(new HemisphereLight(palette.accent, palette.stone, 1.5));

  const key = new DirectionalLight(palette.accent, 3.1);
  key.position.set(-6, 11, -4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 48;
  // Tight enough to stay crisp, wide enough to cover the whole room; the room
  // is fixed-size, so this extent never has to grow.
  const extent = ROOM_HALF + 2;
  key.shadow.camera.left = -extent;
  key.shadow.camera.right = extent;
  key.shadow.camera.top = extent;
  key.shadow.camera.bottom = -extent;
  // Tuned on a hardware adapter, not on the CPU rasteriser: SwiftShader hid the
  // acne these two numbers exist to remove, and the wall faces nearly parallel
  // to the key light striped on real silicon at the softer values.
  key.shadow.bias = -0.0022;
  key.shadow.normalBias = 0.07;
  scene.add(key);

  // The fourth light people forget: a cold rim from behind, so a white character
  // against a dark floor still has an edge.
  const rim = new DirectionalLight(palette.goal, 0.8);
  rim.position.set(7, 4, -8);
  scene.add(rim);

  for (const lantern of LANTERNS) {
    const glow = new PointLight(palette.lantern, 26, 14, 2);
    glow.position.set(lantern.x, 1.15, lantern.z);
    scene.add(glow);
  }

  // A dim fill from the camera side, or every crate face turned away from the
  // key reads as pure black and the stack loses its shape.
  const fill = new DirectionalLight(palette.wall, 0.9);
  fill.position.set(9, 6, 9);
  scene.add(fill);

  scene.add(new AmbientLight(palette.wall, 0.5));
}

// Generated for you. This is ordinary Three.js — edit its visual choices freely.
// ThreeNative does not read this file.
//
// The half of the world that has no collider. None of this is reachable and none of it
// is simulated; it is the distant silhouette behind the coastal play space.
//
// Play.enter imports and invokes createScenery, so deleting this live source without updating
// that caller breaks the build. Editing the backdrop leaves gameplay rules and colliders unchanged.
import type { Material } from "three";
import { type IRockRidgeController, createRockRidge } from "./rockRidge.js";
import { block } from "./shapes.js";

const REEF_ROCKS = [
  { depth: 1.4, height: 1.35, top: -0.35, width: 1.9, x: -3.4, z: -0.5 },
  { depth: 1.6, height: 1.1, top: -0.32, width: 2.1, x: 1.4, z: 0.4 },
] as const;
/**
 * @param random Seeded source for the ridge, handed in by the scene — see `src/scenes/Play.ts`,
 * which builds it with the framework's `createRandom`. It arrives as an argument rather than as
 * an import because nothing in this folder may import a framework package: that is what keeps
 * `src/render/` portable Three.js. The seed is the scene's choice anyway.
 */
export function createScenery(
  rockMaterial: Material,
  ridgeMaterial: Material,
  random: () => number,
): IRockRidgeController {
  const ridgeSeed = Math.floor(random() * 4_294_967_295) >>> 0;
  const scenery = createRockRidge(ridgeMaterial, ridgeSeed, { deferRefinement: true });
  for (const { depth, height, top, width, x, z } of REEF_ROCKS) {
    const rock = block(width, height, depth, rockMaterial, {
      castShadow: false,
      radius: 0.3,
      receiveShadow: false,
    });
    rock.position.set(x, top - height / 2, z);
    scenery.object.add(rock);
  }
  return scenery;
}

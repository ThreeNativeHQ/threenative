// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// The half of the world that has no collider. None of this is reachable and none of it
// is simulated; it exists because a lit slab alone in black reads as a test fixture, and
// because two thirds of a 16:9 frame is above the playable floor. Columns give the ledge
// a below, the ridge gives the sky a behind, and the silhouette of both is what makes a
// screenshot look composed rather than empty.
//
// Delete this file and the game plays identically — which is the point of it living here
// rather than anywhere a rule could grow around it.
import type { Material } from "three";
import { type IRockRidgeController, createRockRidge } from "./rockRidge.js";
import { block } from "./shapes.js";

/** Column tops, so each one meets the underside of the thing it is holding up. */
const COLUMNS = [
  { depth: 1.3, top: -0.2, width: 1.7, x: -3.4, z: -0.5 },
  { depth: 1.6, top: -0.2, width: 2.1, x: 1.4, z: 0.4 },
  { depth: 1.4, top: -0.8, width: 1.5, x: 8.0, z: -0.2 },
] as const;
const COLUMN_HEIGHT = 16;
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
  const scenery = createRockRidge(ridgeMaterial, ridgeSeed);
  for (const { depth, top, width, x, z } of COLUMNS) {
    const column = block(width, COLUMN_HEIGHT, depth, rockMaterial, {
      castShadow: false,
      radius: 0.3,
      receiveShadow: false,
    });
    column.position.set(x, top - COLUMN_HEIGHT / 2, z);
    scenery.object.add(column);
  }
  return scenery;
}

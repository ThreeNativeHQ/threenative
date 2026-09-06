// Generated for you. This is ordinary Three.js — edit its visual choices freely.
// ThreeNative does not read this file.
//
// The half of the world that has no collider. None of this is reachable and none of it
// is simulated; it is the distant silhouette behind the coastal play space, plus the
// foreground flora stand — the second scenery layer, living planting alongside rock.
//
// Play.enter imports and invokes createScenery, so deleting this live source without updating
// that caller breaks the build. Editing the backdrop leaves gameplay rules and colliders unchanged.
import type { Material } from "three";
import { type IFloraStandController, createFloraStand } from "./floraMesh.js";
import {
  FLORA_BOUNDS,
  FLORA_BUDGETS,
  FLORA_ENVELOPE,
  FLORA_SEED,
  FLORA_WIND_STRENGTH,
} from "./floraStand.js";
import { type IRockRidgeController, createRockRidge } from "./rockRidge.js";
import { block } from "./shapes.js";

const REEF_ROCKS = [
  { depth: 1.4, height: 1.35, top: -0.35, width: 1.9, x: -3.4, z: -0.5 },
  { depth: 1.6, height: 1.1, top: -0.32, width: 2.1, x: 1.4, z: 0.4 },
] as const;

export interface ISceneryController extends IRockRidgeController {
  readonly flora: IFloraStandController;
}
/**
 * @param random Seeded source for the ridge, handed in by the scene — see `src/scenes/Play.ts`,
 * which builds it with the framework's `createRandom`. It arrives as an argument rather than as
 * an import because nothing in this folder may import a framework package: that is what keeps
 * `src/render/` portable Three.js. The seed is the scene's choice anyway. Flora takes its own
 * integer seed from `floraStand.ts` so ridge rerolls never perturb the planting.
 */
export function createScenery(
  rockMaterial: Material,
  ridgeMaterial: Material,
  random: () => number,
): ISceneryController {
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
  const flora = createFloraStand({
    bounds: FLORA_BOUNDS,
    budgets: FLORA_BUDGETS,
    envelope: FLORA_ENVELOPE,
    seed: FLORA_SEED,
    windStrength: FLORA_WIND_STRENGTH,
  });
  scenery.object.add(flora.object);
  const controller = scenery as ISceneryController;
  (controller as { flora: IFloraStandController }).flora = flora;
  const previousDispose = scenery.dispose.bind(scenery);
  (controller as { dispose: () => void }).dispose = () => {
    flora.dispose();
    previousDispose();
  };
  return controller;
}

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
import { Group, type Material } from "three";
import { block, makeRandom } from "./shapes.js";

/** Column tops, so each one meets the underside of the thing it is holding up. */
const COLUMNS = [
  { depth: 1.3, top: -0.2, width: 1.7, x: -3.4, z: -0.5 },
  { depth: 1.6, top: -0.2, width: 2.1, x: 1.4, z: 0.4 },
  { depth: 1.4, top: -0.8, width: 1.5, x: 8.0, z: -0.2 },
] as const;
const COLUMN_HEIGHT = 16;
/** Spires between the ledge and the horizon, as `[x, z, width]`. */
const MIDGROUND = [
  [-13.5, -19, 3.6],
  [-6, -27, 2.8],
  [4.5, -23, 3.2],
  [15, -17, 3],
] as const;

export function createScenery(rockMaterial: Material, ridgeMaterial: Material): Group {
  const scenery = new Group();
  for (const { depth, top, width, x, z } of COLUMNS) {
    const column = block(width, COLUMN_HEIGHT, depth, rockMaterial, {
      castShadow: false,
      radius: 0.3,
      receiveShadow: false,
    });
    column.position.set(x, top - COLUMN_HEIGHT / 2, z);
    scenery.add(column);
  }

  // Far enough back that the scene's own fog does the aerial perspective for free, and big
  // enough to still read at that range. Move them closer and they stop being a horizon and
  // start being props standing behind the level.
  // Seeded, never Math.random: the ridge has to be byte-identical on every reload or a
  // screenshot diff is comparing two different worlds.
  const random = makeRandom(20_260_821);
  for (let index = 0; index < 9; index += 1) {
    const height = 12 + random() * 20;
    const width = 12 + random() * 14;
    const ridge = block(width, height, 8, ridgeMaterial, {
      castShadow: false,
      radius: 1.5,
      receiveShadow: false,
    });
    // Inside the sky dome's 90-unit radius. Push one past it and the dome, drawn on its
    // back faces, simply hides it — a ridge that exists, costs a draw, and never appears.
    ridge.position.set(-44 + index * 11 + random() * 5, height / 2 - 20, -56 - random() * 12);
    scenery.add(ridge);
  }

  // One band between the ledge and the horizon. Two depths read as a backdrop; three read
  // as distance, and the middle one is the cheapest of the three to add.
  for (const [x, z, size] of MIDGROUND) {
    const spire = block(size, size * 2.4, size * 0.9, rockMaterial, {
      castShadow: false,
      radius: 0.4,
      receiveShadow: false,
    });
    spire.position.set(x, size * 1.2 - 6, z);
    scenery.add(spire);
  }
  return scenery;
}

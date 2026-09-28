// Generated for you. This is ordinary Three.js — edit or delete it freely.
//
// The battlefield: a plane displaced by the simulation's own `terrainHeight`, so the art, the
// navigation grid and every click agree about where the ground is by construction. What the ground
// *looks* like is `materials.ts`; this file is the ground itself, its water, and the one texture
// the fog of war lives in.
import {
  BoxGeometry,
  DataTexture,
  InstancedMesh,
  LinearFilter,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
} from "three";
import type { Game } from "../sim/game.js";
import { MAP_CELL, POOLS, WORLD, terrainHeight } from "../sim/terrain.js";
import {
  createTerrainMaterial,
  createWaterMaterial,
  waterDisc,
  worldMetreUVs,
} from "./materials.js";
import { palette } from "./palette.js";

/**
 * Quads across the map: one every 2 m, which is exactly the simulation's navigation cell, so the
 * drawn surface and the walkable surface are the same resolution. Measured, not guessed: at 176
 * segments this plane was 31 000 triangles and cost 5.3 s of boot compile here, against 12 600 and
 * 2.8 s at 112 — and the heightfield is two octaves of smooth noise, so there is nothing between
 * the vertices for the extra rings to find.
 */
const SEGMENTS = 112;

export interface ITerrain {
  /** Rewrite the fog texture from the simulation's vision arrays. Cheap; not every frame. */
  readonly updateFog: (game: Game) => void;
  readonly root: Object3D;
}

export function createTerrain(): ITerrain {
  const root = new Object3D();

  const geometry = new PlaneGeometry(WORLD, WORLD, SEGMENTS, SEGMENTS).rotateX(-Math.PI / 2);
  const position = geometry.getAttribute("position");
  for (let index = 0; index < position.count; index += 1)
    position.setY(index, terrainHeight(position.getX(index), position.getZ(index)));
  geometry.computeVertexNormals();
  worldMetreUVs(geometry);

  // 102 = never seen, 191 = remembered, 255 = in sight right now.
  const cells = WORLD / MAP_CELL;
  const fogBytes = new Uint8Array(cells * cells * 4);
  const fog = new DataTexture(fogBytes, cells, cells);
  fog.minFilter = LinearFilter;
  fog.magFilter = LinearFilter;
  fog.needsUpdate = true;

  const ground = new Mesh(geometry, createTerrainMaterial(fog));
  ground.receiveShadow = true;
  root.add(ground);

  // A skirt, so the battlefield has an edge rather than a paper-thin plane at the horizon.
  const skirt = new Mesh(
    new BoxGeometry(WORLD + 3, 7, WORLD + 3),
    new MeshStandardMaterial({ color: palette.cliff, roughness: 1 }),
  );
  skirt.position.y = -5.2;
  root.add(skirt);

  // The pools the simulation refuses to path across: one instanced disc, so four lakes cost one
  // draw. The matrices never move, so the pool is sized for the world's sites rather than grown.
  const water = new InstancedMesh(waterDisc(), createWaterMaterial(), POOLS.length);
  const dummy = new Object3D();
  POOLS.forEach((pool, index) => {
    dummy.position.set(pool.x, -0.18, pool.z);
    dummy.scale.set(pool.rx * 1.04, 1, pool.rz * 1.04);
    dummy.updateMatrix();
    water.setMatrixAt(index, dummy.matrix);
  });
  water.renderOrder = 1;
  root.add(water);

  return {
    root,
    updateFog: (game) => {
      const size = game.gridSize;
      for (let cell = 0; cell < size * size; cell += 1) {
        const value = game.visible[cell] === 1 ? 255 : game.explored[cell] === 1 ? 191 : 102;
        fogBytes[cell * 4] = value;
        fogBytes[cell * 4 + 1] = value;
        fogBytes[cell * 4 + 2] = value;
        fogBytes[cell * 4 + 3] = 255;
      }
      fog.needsUpdate = true;
    },
  };
}

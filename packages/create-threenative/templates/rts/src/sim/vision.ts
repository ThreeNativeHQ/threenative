/** Per-faction fog of war: `visible` is what a unit sees now, `explored` is what it has ever seen. */

import type { Game } from "./game.js";
import { HALF } from "./terrain.js";
import { TYPES, clamp } from "./types.js";

export function updateVision(game: Game): void {
  const size = game.gridSize;
  const entities = game.entities;
  for (const player of game.players) {
    player.visible.fill(0);
    if (player.eliminated) continue;
    // Over the live list rather than `own()`, which would filter a fresh array per player per tick.
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (e === undefined || e.team !== player.team || e.hp <= 0 || e.garrisonId) continue;
      const radius = TYPES[e.type].sight;
      const cx = Math.floor((e.x + HALF) / game.cell);
      const cz = Math.floor((e.z + HALF) / game.cell);
      const rr = Math.ceil(radius / game.cell);
      for (let z = Math.max(0, cz - rr); z < Math.min(size, cz + rr + 1); z++) {
        for (let x = Math.max(0, cx - rr); x < Math.min(size, cx + rr + 1); x++) {
          if ((x - cx) ** 2 + (z - cz) ** 2 > rr * rr) continue;
          player.visible[z * size + x] = 1;
          player.explored[z * size + x] = 1;
        }
      }
    }
  }
}

export function visibleAt(game: Game, x: number, z: number, team = 0): boolean {
  const player = game.players[team];
  if (
    !player ||
    !Number.isFinite(x) ||
    !Number.isFinite(z) ||
    Math.abs(x) > HALF ||
    Math.abs(z) > HALF
  ) {
    return false;
  }
  const ix = clamp(Math.floor((x + HALF) / game.cell), 0, game.gridSize - 1);
  const iz = clamp(Math.floor((z + HALF) / game.cell), 0, game.gridSize - 1);
  return player.visible[iz * game.gridSize + ix] === 1;
}

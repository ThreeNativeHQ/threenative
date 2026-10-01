import { mkdir, writeFile } from "node:fs/promises";
import { Mask, Terrain, bakeMesh } from "@threenative/terrain";
import { terrainPalette } from "../src/render/palette.js";

// Authoring runs before either runtime is bundled. The game imports only the baked JSON.

export const forest = new Terrain({ size: 512, resolution: 257, seed: 73 })
  .noise({ id: "hills", base: 18, amplitude: 16, scale: 180, warp: 35, octaves: 5 })
  .stamp({
    id: "eroded-hill",
    at: [-40, -60],
    radius: [130, 105],
    amplitude: 65,
    shape: "mountain",
    roughness: 0.17,
  })
  .erode({ id: "weathering", method: "hydraulic", droplets: 2400, maxSteps: 40 })
  .materials({
    id: "surfaces",
    rules: [
      { material: "dirt", mask: Mask.noise(36, 0.67, 73, 0.14), strength: 0.55 },
      { material: "rock", mask: Mask.slope(34, 90, 9) },
    ],
  })
  .road({
    id: "access-road",
    points: [
      [-240, 20, 160],
      [-100, 22, 160],
      [30, 25, 160],
      [230, 28, 160],
    ],
    width: 10,
    shoulder: 8,
  })
  .flatten({ id: "building-pad", at: [-120, 150], radius: 18, height: 22, falloff: 0.35 })
  .paint({ id: "pad-surface", at: [-120, 150], radius: 18, material: "dirt" })
  .river({
    id: "river",
    points: [
      [55, 18, -240],
      [80, 12, -80],
      [70, 6, 80],
      [85, 3, 240],
    ],
    width: 12,
    depth: 4,
    shoulder: 8,
    enforceDownhill: true,
  });
export const coastal = new Terrain({ size: 512, resolution: 257, seed: 73 })
  .noise({
    id: "island",
    base: 13,
    amplitude: 27,
    scale: 150,
    warp: 42,
    octaves: 6,
    island: true,
    coastDepth: 23,
  })
  .stamp({
    id: "massif",
    at: [-23, -12],
    radius: [159, 154],
    amplitude: 70,
    shape: "mountain",
    roughness: 0.24,
  })
  .erode({ id: "weathering", method: "hydraulic", droplets: 2400, maxSteps: 40 })
  .materials({
    id: "surfaces",
    rules: [
      { material: "rock", mask: Mask.slope(35, 90, 10) },
      { material: "sand", mask: Mask.height(-1000, 6, 4) },
    ],
  })
  .water({ id: "ocean", kind: "ocean", level: 1.5, radius: 512 });
const worlds = {};
for (const [name, terrain] of Object.entries({ forest, coastal })) {
  const state = terrain.evaluate();
  const mesh = bakeMesh(state, { palette: terrainPalette });
  worlds[name] = {
    size: state.size,
    resolution: state.resolution,
    heights: Array.from(state.height),
    colors: Array.from(mesh.colors),
    rivers: state.rivers,
    waterLevel: state.waters.find((water) => water.kind === "ocean")?.level ?? null,
  };
}
await mkdir(new URL("../src/world/", import.meta.url), { recursive: true });
await writeFile(new URL("../src/world/baked.json", import.meta.url), JSON.stringify(worlds));
console.log("Baked two seeded 512 m / 257-vertex worlds; authoring is outside the play graph.");

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
    // No absolute elevations: the road is graded to the ground it crosses, so it is a bench cut
    // into the hillside instead of a causeway standing 15 m above it.
    followTerrain: true,
    points: [
      [-240, null, 160],
      [-100, null, 160],
      // It ends on the near bank: past here it would cross the river, and a road the river cuts through
      // is an eight-metre cliff in the middle of a track until there is a ford or a bridge to draw.
      [40, null, 160],
    ],
    width: 10,
    shoulder: 8,
  })
  // The pad takes the local terrain height; its blend reaches as far as the deepest cut or fill.
  .flatten({ id: "building-pad", at: [-120, 150], radius: 18, falloff: 0.35 })
  .paint({ id: "pad-surface", at: [-120, 150], radius: 18, material: "dirt" })
  .river({
    id: "river",
    // A stream down the drainage line the terrain actually has: a steepest-descent trace from the east
    // ridge (with this layer off) runs west into the closed basin under the mountain's south flank, so
    // the stream follows it and the basin holds the lake it feeds.
    followTerrain: true,
    points: [
      [118, null, -158],
      [80, null, -161],
      [40, null, -160],
      [6, null, -158],
      [-36, null, -161],
    ],
    width: 9,
    depth: 1.8,
    shoulder: 16,
    enforceDownhill: true,
  })
  // The basin every drainage trace ends in, at 13.6 m with its lip near 15.2 m: filled to just under
  // the lip it is a lake, not a hollow with nothing in it.
  .water({ id: "lake", kind: "lake", at: [-76, -164], radius: 95, level: 15 });
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
    lakes: state.waters
      .filter((water) => water.kind === "lake")
      .map(({ id, at, radius, level }) => ({ id, at, radius, level })),
  };
}
await mkdir(new URL("../src/world/", import.meta.url), { recursive: true });
await writeFile(new URL("../src/world/baked.json", import.meta.url), JSON.stringify(worlds));
console.log("Baked two seeded 512 m / 257-vertex worlds; authoring is outside the play graph.");

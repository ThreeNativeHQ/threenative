import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Mask, Terrain, bakeMesh } from "@threenative/terrain";
import { terrainPalette } from "../src/render/palette.js";

// Authoring runs before either runtime is bundled. The game imports only the baked JSON.

export const forest = new Terrain({ size: 512, resolution: 257, seed: 73 })
  .noise({ id: "hills", base: 22, amplitude: 34, scale: 175, warp: 45, octaves: 6 })
  // Billow folds give the rounded shoulders and troughs of a worn landscape; the hydraulic pass then
  // finds the troughs and turns them into drainage, which is what makes the land read as eroded
  // rather than as smooth noise with a peak on it.
  .noise({
    id: "valleys",
    base: 0,
    amplitude: 14,
    scale: 110,
    warp: 40,
    octaves: 3,
    mode: "billow",
  })
  .stamp({
    id: "eroded-hill",
    at: [-40, -60],
    radius: [130, 105],
    amplitude: 72,
    shape: "mountain",
    roughness: 0.17,
  })
  // Break the eastern slope's parallel drainage before erosion, away from the western lake basin.
  .noise({
    id: "drainage-breakup",
    base: 0,
    amplitude: 7,
    scale: 43,
    warp: 33,
    octaves: 3,
    lacunarity: 1.87,
    seed: 127,
    mask: Mask.rectangle([176, 24], [300, 464], -11, 0.6),
  })
  // Less momentum follows curved troughs; a smaller sediment load leaves rounded banks.
  .erode({
    id: "weathering",
    method: "hydraulic",
    inertia: 0.08,
    capacity: 3,
    erosion: 0.025,
    deposition: 0.35,
    evaporation: 0.035,
  })
  // One settling pass over the carved surface. Every droplet leaves the edge of its own dimple, and
  // without this the hillside is pocked rather than weathered. It is one pass, not two: a second
  // flattens the whole hill into rolling dough with no rill left anywhere on it.
  .smooth({ id: "settle", iterations: 1, strength: 0.5 })
  // Rills and small crests, added after the settle so they survive it. Placed before, the pass
  // above erases them; placed after the talus, the talus slides them off again.
  .noise({ id: "detail", base: 0, amplitude: 3, scale: 60, warp: 12, octaves: 4, mode: "ridged" })
  // Material past 34 degrees slides to its lowest neighbour and piles as a fan at the foot of the
  // slope; without this the talus is either absent or a single-cell spike.
  .erode({ id: "talus", method: "thermal", talus: 34, iterations: 16 })
  // The ridged detail is a crest, and a crest is a single-cell spike until something settles it. The
  // scree pass below is the last one, so the world needs one light pass after it, not only before.
  .smooth({ id: "drift", iterations: 1, strength: 0.4 })
  .materials({
    id: "surfaces",
    rules: [
      // Bare earth is a worn band along the drainage and a scatter on the steeper ground, not one
      // smooth blob tens of metres across: a lower frequency than the renderer's fraying can hide
      // still reads as a brown amoeba with a hard rim.
      { material: "dirt", mask: Mask.noise(78, 0.52, 73, 0.32), strength: 0.5 },
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
  .flatten({ id: "building-pad", at: [-120, 150], radius: 18, falloff: 0.75 })
  .paint({ id: "pad-surface", at: [-120, 150], radius: 18, material: "dirt" })
  .river({
    id: "river",
    // A stream down the drainage line the eroded terrain actually has: re-traced by steepest descent
    // from the north-west shoulder (with this layer off) after the erosion recipe changed, so it
    // still runs downhill the whole way and ends in the basin the lake sits in.
    followTerrain: true,
    points: [
      [-160, null, -180],
      [-156, null, -188],
      [-148, null, -196],
      [-140, null, -202],
      [-132, null, -208],
      [-124, null, -206],
      [-116, null, -204],
      [-112, null, -198],
      [-112, null, -192],
      [-108, null, -188],
      [-106, null, -184],
      [-100, null, -182],
      [-96, null, -178],
    ],
    width: 9,
    depth: 1.8,
    shoulder: 16,
    enforceDownhill: true,
  })
  // The basin the stream above ends in, at 11 m with its lip near 12.6 m: filled to just under the
  // lip it is a lake, not a hollow with nothing in it.
  .water({ id: "lake", kind: "lake", at: [-96, -178], radius: 62, level: 12.4 });
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
  .noise({
    id: "valleys",
    base: 0,
    amplitude: 13,
    scale: 105,
    warp: 22,
    octaves: 3,
    mode: "billow",
  })
  .stamp({
    id: "massif",
    at: [-23, -12],
    radius: [159, 154],
    amplitude: 78,
    shape: "mountain",
    roughness: 0.24,
  })
  .erode({ id: "weathering", method: "hydraulic" })
  .smooth({ id: "settle", iterations: 1, strength: 0.5 })
  .noise({ id: "detail", base: 0, amplitude: 3, scale: 58, warp: 12, octaves: 4, mode: "ridged" })
  // The sea cliff survives because the talus is steep: 38 degrees lets the windward face stand as a
  // face while the gullies feeding it still cut back.
  .erode({ id: "talus", method: "thermal", talus: 38, iterations: 12 })
  .smooth({ id: "drift", iterations: 1, strength: 0.4 })
  .materials({
    id: "surfaces",
    rules: [
      { material: "rock", mask: Mask.slope(35, 90, 10) },
      { material: "sand", mask: Mask.height(-1000, 6, 4) },
    ],
  })
  .water({ id: "ocean", kind: "ocean", level: 1.5, radius: 512 });
// Alpine: intersecting arêtes, cirque headwalls and a glacial trough. Settle talus below
// the exposed faces without relaxing the entire massif to the scree angle.
export const alpine = new Terrain({ size: 512, resolution: 257, seed: 41 })
  .noise({ id: "foothills", base: 16, amplitude: 18, scale: 180, warp: 35, octaves: 4 })
  .stamp({
    id: "snow-shelf",
    at: [0, -60],
    radius: [172, 145],
    amplitude: 105,
    shape: "mesa",
    roughness: 0.025,
    blend: "max",
    offset: 16,
  })
  .stamp({
    id: "main-arete",
    at: [15, -65],
    radius: [165, 120],
    amplitude: 132,
    shape: "ridge",
    rotation: -22,
    roughness: 0.025,
    blend: "max",
    offset: 16,
  })
  .stamp({
    id: "side-arete",
    at: [-100, 15],
    radius: [150, 90],
    amplitude: 112,
    shape: "ridge",
    rotation: 58,
    roughness: 0.03,
    blend: "max",
    offset: 16,
  })
  .stamp({
    id: "east-horn",
    at: [55, -95],
    radius: [120, 90],
    amplitude: 140,
    shape: "ridge",
    rotation: 78,
    roughness: 0.08,
    blend: "max",
    offset: 20,
  })
  .stamp({
    id: "west-horn",
    at: [-80, -40],
    radius: [130, 85],
    amplitude: 125,
    shape: "ridge",
    rotation: -38,
    roughness: 0.075,
    blend: "max",
    offset: 16,
  })
  .stamp({
    id: "cirque-east",
    at: [90, -12],
    radius: [78, 84],
    amplitude: 36,
    shape: "valley",
    roughness: 0.04,
  })
  .stamp({
    id: "cirque-west",
    at: [-40, 10],
    radius: [75, 84],
    amplitude: 32,
    shape: "valley",
    roughness: 0.04,
  })
  .noise({
    id: "crags",
    base: 0,
    amplitude: 26,
    scale: 115,
    warp: 14,
    octaves: 3,
    persistence: 0.4,
    mode: "ridged",
    mask: Mask.height(45, 1e9, 18),
  })
  .noise({
    id: "fractures",
    base: 0,
    amplitude: 9,
    scale: 35,
    warp: 12,
    octaves: 3,
    persistence: 0.45,
    mode: "ridged",
    mask: Mask.and(Mask.height(48, 1e9, 12), Mask.slope(20, 80, 12)),
  })
  .terrace({
    id: "rock-ledges",
    step: 18,
    softness: 0.55,
    strength: 0.28,
    mask: Mask.and(Mask.height(55, 170, 12), Mask.slope(26, 70, 12)),
  })
  .erode({
    id: "weathering",
    method: "hydraulic",
    inertia: 0.05,
    capacity: 2.4,
    erosion: 0.025,
    deposition: 0.2,
    evaporation: 0.035,
    droplets: 38000,
  })
  .erode({ id: "scree", method: "thermal", talus: 45, iterations: 8, rate: 0.12 })
  .smooth({ id: "settle", iterations: 1, strength: 0.45 })
  .river({
    id: "glacial-trough",
    followTerrain: true,
    points: [
      [-240, null, 155],
      [-100, null, 110],
      [20, null, 95],
      [230, null, 130],
    ],
    width: 38,
    depth: 6,
    shoulder: 42,
    water: false,
    material: "rock",
  })
  .materials({
    id: "surfaces",
    rules: [
      { material: "dirt", mask: Mask.noise(38, 0.7, 41, 0.25), strength: 0.25 },
      { material: "rock", mask: Mask.height(48, 1e9, 22), strength: 0.65 },
      { material: "rock", mask: Mask.slope(30, 90, 8) },
      { material: "snow", mask: Mask.and(Mask.height(70, 1e9, 18), Mask.slope(0, 36, 7)) },
    ],
  });
// Desert: resistant caprock plateaux, stepped walls, loose aprons and wind-shaped dunes.
// Data stamps reuse the installed operation; the built-in mesa's half-radius shoulder is too round.
function mesaProfile(height) {
  const width = 129;
  return {
    width,
    height: width,
    values: Array.from({ length: width * width }, (_, i) => {
      const x = ((i % width) / (width - 1) - 0.5) * 2;
      const z = (Math.floor(i / width) / (width - 1) - 0.5) * 2;
      const angle = Math.atan2(z, x);
      const d = Math.hypot(x, z) + 0.016 * Math.sin(angle * 7) + 0.012 * Math.sin(angle * 13 + 1);
      const cap =
        d <= 0.72
          ? 1
          : d < 0.79
            ? 1 - ((d - 0.72) / 0.07) * 0.82
            : Math.max(0, (1 - d) / 0.21) * 0.18;
      return height * cap;
    }),
  };
}
export const desert = new Terrain({ size: 512, resolution: 257, seed: 97 })
  .noise({ id: "plain", base: 8, amplitude: 4, scale: 220, warp: 30, octaves: 3 })
  .stamp({
    id: "mesa-west",
    at: [-140, -60],
    radius: [82, 65],
    data: mesaProfile(66),
    falloff: 0,
  })
  .stamp({
    id: "mesa-north",
    at: [40, -170],
    radius: [68, 88],
    data: mesaProfile(82),
    falloff: 0,
  })
  .stamp({
    id: "butte",
    at: [-30, 60],
    radius: [36, 31],
    data: mesaProfile(48),
    falloff: 0,
  })
  .stamp({
    id: "west-cleft",
    at: [-77, -45],
    radius: [21, 32],
    amplitude: 16,
    shape: "valley",
    roughness: 0.08,
  })
  .stamp({
    id: "north-cleft",
    at: [4, -217],
    radius: [25, 22],
    amplitude: 12,
    shape: "valley",
    roughness: 0.06,
  })
  .erode({
    id: "weathering",
    method: "hydraulic",
    inertia: 0.06,
    capacity: 2,
    erosion: 0.02,
    deposition: 0.35,
  })
  .terrace({
    id: "benches",
    step: 8,
    softness: 0.13,
    strength: 0.96,
    offset: 2,
    mask: Mask.height(18, 1e9, 6),
  })
  .flatten({ id: "west-caprock", at: [-140, -60], radius: 42, height: 78, falloff: 0.15 })
  .flatten({ id: "north-caprock", at: [40, -170], radius: 40, height: 94, falloff: 0.15 })
  .flatten({ id: "butte-caprock", at: [-30, 60], radius: 17, height: 60, falloff: 0.12 })
  .erode({ id: "aprons", method: "thermal", talus: 57, iterations: 5, rate: 0.12 })
  .smooth({ id: "cliff-settle", iterations: 1, strength: 0.12 })
  .smooth({ id: "sand-settle", iterations: 1, strength: 0.25, mask: Mask.height(-1e9, 22, 5) })
  .stamp({
    id: "dune-west",
    at: [80, 95],
    radius: [135, 24],
    amplitude: 5,
    shape: "ridge",
    rotation: -32,
    roughness: 0.05,
  })
  .stamp({
    id: "dune-east",
    at: [125, 155],
    radius: [140, 27],
    amplitude: 7,
    shape: "ridge",
    rotation: -32,
    roughness: 0.05,
  })
  .stamp({
    id: "dune-far",
    at: [175, 205],
    radius: [120, 28],
    amplitude: 6,
    shape: "ridge",
    rotation: -32,
    roughness: 0.06,
  })
  .stamp({
    id: "dune-hollow",
    at: [145, 145],
    radius: [36, 70],
    amplitude: 3,
    shape: "valley",
    rotation: 18,
    roughness: 0.05,
  })
  .river({
    id: "wash",
    followTerrain: true,
    points: [
      [-240, null, 190],
      [-100, null, 130],
      [30, null, 0],
      [240, null, -80],
    ],
    width: 12,
    depth: 3,
    shoulder: 12,
    water: false,
    material: "sand",
    enforceDownhill: true,
  })
  .materials({
    id: "surfaces",
    rules: [
      { material: "sand", mask: Mask.all() },
      { material: "dirt", mask: Mask.noise(40, 0.7, 97, 0.2), strength: 0.25 },
      { material: "rock", mask: Mask.slope(28, 90, 8) },
    ],
  });
// Tundra: rolling moraine, low ridges and kettle ponds connected by braided meltwater.
export const tundra = new Terrain({ size: 512, resolution: 257, seed: 131 })
  .noise({
    id: "moraine",
    base: 14,
    amplitude: 16,
    scale: 180,
    warp: 45,
    octaves: 4,
    persistence: 0.38,
  })
  .stamp({
    id: "low-ridge",
    at: [-75, -85],
    radius: [220, 38],
    amplitude: 9,
    shape: "ridge",
    rotation: -25,
    roughness: 0.09,
  })
  .stamp({
    id: "near-moraine",
    at: [115, 90],
    radius: [170, 27],
    amplitude: 5,
    shape: "ridge",
    rotation: -30,
    roughness: 0.07,
  })
  .noise({
    id: "outcrops",
    base: 0,
    amplitude: 1.5,
    scale: 42,
    octaves: 3,
    mode: "ridged",
    mask: Mask.noise(90, 0.68, 131, 0.2),
  })
  .erode({ id: "weathering", method: "hydraulic", capacity: 2, erosion: 0.015 })
  .smooth({ id: "settle", iterations: 1, strength: 0.5 })
  .flatten({ id: "near-kettle-bed", at: [65, 80], radius: 30, height: 8, falloff: 0.65 })
  .flatten({ id: "far-kettle-bed", at: [-65, -50], radius: 42, height: 9, falloff: 0.65 })
  .river({
    id: "meltwater",
    points: [
      [-210, 17, -135],
      [-125, 14, -80],
      [-100, 11, -90],
      [-65, 11, -50],
      [-30, 11, -15],
      [0, 10.3, 5],
      [38, 9.8, 47],
      [65, 9.8, 80],
      [100, 9.8, 100],
      [160, 8, 140],
      [250, 7, 150],
    ],
    width: 7,
    depth: 1.5,
    shoulder: 18,
    enforceDownhill: true,
  })
  .river({
    id: "braid",
    points: [
      [-65, 11, -50],
      [-40, 11, -18],
      [-30, 10.4, 40],
      [15, 9.8, 105],
      [65, 9.8, 80],
    ],
    width: 4,
    depth: 1.2,
    shoulder: 12,
    enforceDownhill: true,
  })
  .water({ id: "near-kettle", kind: "lake", at: [65, 80], radius: 34, level: 9.8 })
  .water({ id: "far-kettle", kind: "lake", at: [-65, -50], radius: 46, level: 11 })
  .materials({
    id: "surfaces",
    rules: [
      { material: "moss", mask: Mask.all() },
      { material: "snow", mask: Mask.noise(85, 0.68, 131, 0.3), strength: 0.6 },
      { material: "rock", mask: Mask.slope(23, 90, 8) },
    ],
  });
// `pnpm dev` runs this on every start, and grid-scaled erosion costs ~19 s for the five worlds
// against the dev server's 15 s readiness budget. The recipes are seeded and deterministic, so a
// bake is only needed when the recipe, the palette it colours with, or the terrain build it
// evaluates against has changed since the output was written. `bake.mjs --force` overrides.
const recipes = { forest, coastal, alpine, desert, tundra };
// Forest/coast keep their existing bundle. The other three are separate lazy imports: every
// baked world is a 257-square of heights/colours, so bundling all five would add about 15 MB
// to the initial page module.
const drawn = new Set(["forest", "coastal"]);
const outputDir = new URL("../src/world/", import.meta.url);
const { readFile, stat } = await import("node:fs/promises");
const fingerprint = createHash("sha256")
  .update(
    JSON.stringify(Object.fromEntries(Object.entries(recipes).map(([n, t]) => [n, t.toJSON()]))),
  )
  .update(JSON.stringify(terrainPalette))
  .update(await readFile(new URL("../../../packages/terrain/dist/index.js", import.meta.url)))
  .digest("hex");

// An importer that only wants the recipes must not rewrite the baked files either: a fresh stamp
// skips the bake for every caller, so a dev server or a proof running beside it is never reloaded
// under its feet. `process.exit` is not how this skips — it would take the importer down with it.
const isEntry = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
let baked = false;
if (!(isEntry && process.argv.includes("--force"))) {
  try {
    const stamp = new URL(".bake-stamp", outputDir);
    const [old, out] = await Promise.all([readFile(stamp, "utf8"), stat(stamp)]);
    // `drawn` worlds live inside baked.json; the rest are written beside it. Checking the drawn
    // set's own filenames would stat files that never exist and re-bake on every start.
    const undrawn = Object.keys(recipes).filter((name) => !drawn.has(name));
    const stale = (
      await Promise.all(
        ["baked.json", ...undrawn.map((name) => `${name}.json`)].map((file) =>
          stat(new URL(file, outputDir)).then(
            (s) => s.mtimeMs > out.mtimeMs,
            () => true,
          ),
        ),
      )
    ).some(Boolean);
    if (old.trim() === fingerprint && !stale) {
      console.log("Worlds are already baked from this recipe and terrain build; nothing to do.");
      baked = true;
    }
  } catch {
    // No stamp yet: bake.
  }
}

if (!baked) {
  const worlds = {};
  for (const [name, terrain] of Object.entries(recipes)) {
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
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    new URL("../src/world/baked.json", import.meta.url),
    JSON.stringify(Object.fromEntries(Object.entries(worlds).filter(([name]) => drawn.has(name)))),
  );
  for (const [name, world] of Object.entries(worlds))
    if (!drawn.has(name))
      await writeFile(new URL(`${name}.json`, outputDir), JSON.stringify(world));
  await writeFile(new URL(".bake-stamp", outputDir), `${fingerprint}\n`);
  console.log("Baked five seeded 512 m / 257-vertex worlds; authoring is outside the play graph.");
}

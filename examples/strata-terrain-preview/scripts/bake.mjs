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
// Mountain / Alpine: a massif and a side ridge over foothills, crags only where it is high, and
// snow that holds on the flatter high ground while the steep faces stay bare rock.
export const alpine = new Terrain({ size: 512, resolution: 257, seed: 41 })
  .noise({ id: "foothills", base: 12, amplitude: 26, scale: 160, warp: 40, octaves: 6 })
  .noise({
    id: "valleys",
    base: 0,
    amplitude: 18,
    scale: 100,
    warp: 30,
    octaves: 3,
    mode: "billow",
  })
  .stamp({
    id: "summit",
    at: [30, -40],
    radius: [215, 180],
    amplitude: 158,
    shape: "mountain",
    roughness: 0.18,
  })
  .stamp({
    id: "side-ridge",
    at: [-120, 70],
    radius: [175, 120],
    amplitude: 70,
    shape: "ridge",
    roughness: 0.18,
  })
  // A broad summit snowfield, cut before weathering so its rim drains and erodes with the massif.
  .flatten({ id: "summit-snowfield", at: [30, -40], radius: 62, height: 120, falloff: 0.5 })
  // Crags only where it is high: ridged noise over the whole massif roughened the foothills past
  // 30 degrees, which is a rockfall, not a mountain.
  .noise({
    id: "crags",
    base: 0,
    amplitude: 9,
    scale: 38,
    octaves: 4,
    mode: "ridged",
    mask: Mask.height(60, 1e9, 20),
  })
  .erode({ id: "weathering", method: "hydraulic" })
  .smooth({ id: "settle", iterations: 1, strength: 0.5 })
  .noise({ id: "detail", base: 0, amplitude: 3, scale: 60, warp: 14, octaves: 4, mode: "ridged" })
  // A 34-degree talus is loose scree: rock past that angle slides off the faces and piles in fans below,
  // which is what puts the grey aprons under the snowline.
  .erode({ id: "scree", method: "thermal", talus: 34, iterations: 80 })
  .smooth({ id: "drift", iterations: 1, strength: 0.4 })
  .materials({
    id: "surfaces",
    rules: [
      { material: "dirt", mask: Mask.noise(30, 0.72, 41, 0.2), strength: 0.3 },
      { material: "rock", mask: Mask.slope(32, 90, 8) },
      { material: "snow", mask: Mask.and(Mask.height(85, 1e9, 12), Mask.slope(0, 38, 6)) },
    ],
  });

// Desert / Canyon: a low plain with three mesas, a dune field and a dry wash cut through it — sand
// and sandstone rather than a recoloured forest.
export const desert = new Terrain({ size: 512, resolution: 257, seed: 97 })
  .noise({ id: "plain", base: 8, amplitude: 7, scale: 220, warp: 30, octaves: 4 })
  .stamp({
    id: "mesa-west",
    at: [-140, -60],
    radius: [80, 64],
    amplitude: 46,
    shape: "mesa",
    // Low roughness on purpose: a mesa is a flat-topped block, and the stamp's own fbm skin at 0.25
    // stood a metre proud of its neighbours over a tenth of the map as single-cell spikes.
    roughness: 0.06,
  })
  .stamp({
    id: "mesa-north",
    at: [40, -170],
    radius: [62, 90],
    amplitude: 58,
    shape: "mesa",
    roughness: 0.06,
  })
  .stamp({
    id: "butte",
    at: [-30, 60],
    radius: [34, 30],
    amplitude: 40,
    shape: "mesa",
    roughness: 0.08,
  })
  .stamp({
    id: "dunes",
    at: [140, 130],
    radius: [150, 120],
    amplitude: 12,
    shape: "dune",
    roughness: 0.4,
  })
  .erode({ id: "weathering", method: "hydraulic" })
  // Terracing the mesa walls: stratified rock erodes to flat benches separated by steep risers, which
  // is the silhouette a mesa actually has. A smooth cone at this scale is a lump, not a mesa.
  .terrace({ id: "benches", step: 6, softness: 0.12, strength: 0.55, offset: 6 })
  .smooth({ id: "settle", iterations: 3, strength: 0.65 })
  .noise({ id: "detail", base: 0, amplitude: 0.8, scale: 74, warp: 10, octaves: 4, mode: "ridged" })
  .erode({ id: "talus", method: "thermal", talus: 38, iterations: 12 })
  .smooth({ id: "drift", iterations: 2, strength: 0.55 })
  .river({
    id: "wash",
    followTerrain: true,
    points: [
      [-240, null, 200],
      [-90, null, 150],
      [60, null, 20],
      [240, null, -80],
    ],
    width: 16,
    depth: 5,
    shoulder: 10,
    water: false,
    material: "sand",
    enforceDownhill: true,
  })
  .materials({
    id: "surfaces",
    rules: [
      { material: "sand", mask: Mask.all() },
      { material: "dirt", mask: Mask.noise(26, 0.7, 97, 0.2), strength: 0.35 },
      { material: "rock", mask: Mask.slope(28, 90, 8) },
    ],
  });

// Snow / Tundra: rolling snowfields with ridged rocky outcrops and moss where the wind strips the
// cover; its frozen lake is an ice surface, not a fluid.
export const tundra = new Terrain({ size: 512, resolution: 257, seed: 131 })
  .noise({ id: "snowfield", base: 12, amplitude: 12, scale: 240, warp: 34, octaves: 4 })
  .noise({ id: "folds", base: 0, amplitude: 4, scale: 170, warp: 20, octaves: 3, mode: "billow" })
  // Outcrops in patches, not everywhere: ridged noise over the whole field roughened a third of a
  // snowfield past 30 degrees, which is a rockfall, not tundra.
  .noise({
    id: "outcrops",
    base: 0,
    amplitude: 2.5,
    scale: 55,
    octaves: 3,
    mode: "ridged",
    mask: Mask.noise(90, 0.68, 131, 0.2),
  })
  .erode({ id: "weathering", method: "hydraulic" })
  .smooth({ id: "settle", iterations: 1, strength: 0.5 })
  .noise({ id: "detail", base: 0, amplitude: 0.8, scale: 74, warp: 10, octaves: 3, mode: "ridged" })
  .erode({ id: "talus", method: "thermal", talus: 33, iterations: 12 })
  .smooth({ id: "drift", iterations: 1, strength: 0.4 })
  .materials({
    id: "surfaces",
    rules: [
      { material: "snow", mask: Mask.all() },
      { material: "moss", mask: Mask.noise(40, 0.74, 131, 0.2), strength: 0.45 },
      { material: "rock", mask: Mask.slope(24, 90, 8) },
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

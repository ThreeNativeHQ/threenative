import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Mask, Terrain, bakeMesh } from "@threenative/terrain";
import { terrainPalette } from "../src/render/palette.js";

// Authoring runs before either runtime is bundled. The game imports only the baked JSON.

// Public-domain surveyed elevations; one offset and orientation are shared by detail and horizon.
const dem = {};
for (const name of ["alpine", "desert", "alpine-horizon", "desert-horizon"]) {
  const meta = JSON.parse(await readFile(new URL(`dem/${name}.json`, import.meta.url), "utf8"));
  const bytes = await readFile(new URL(`dem/${name}.bin`, import.meta.url));
  assert.equal(meta.encoding, "int16-le-decimetres-relative-to-elevationOffset");
  assert.equal(bytes.length, meta.resolution ** 2 * 2, `${name}: truncated DEM`);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    meta.sha256,
    `${name}: DEM hash mismatch`,
  );
  dem[name] = {
    size: meta.size,
    resolution: meta.resolution,
    data: {
      width: meta.resolution,
      height: meta.resolution,
      values: Array.from({ length: meta.resolution ** 2 }, (_, i) => bytes.readInt16LE(i * 2) / 10),
    },
  };
}

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
  // Dense rainfall follows curved troughs; strong pickup is bounded by the downstream bed.
  .erode({
    id: "weathering",
    method: "hydraulic",
    inertia: 0.08,
    capacity: 5,
    erosion: 0.18,
    strength: 0.7,
    droplets: 180000,
    maxSteps: 100,
    // Retain the existing river mouth and lake basin while carving the uphill catchment.
    mask: Mask.not(Mask.circle([-96, -178], 76, 0.5)),
    deposition: 0.28,
    evaporation: 0.035,
  })
  // Light settling removes the grid-scale lip without erasing the drainage.
  .smooth({ id: "settle", iterations: 1, strength: 0.12 })
  // Sub-metre bedrock grain; drainage is carved by water, not added as ridged noise.
  .noise({ id: "detail", base: 0, amplitude: 0.6, scale: 60, warp: 12, octaves: 3, mode: "ridged" })
  // Material past 34 degrees slides to its lowest neighbour and piles as a fan at the foot of the
  // slope; without this the talus is either absent or a single-cell spike.
  .erode({ id: "talus", method: "thermal", talus: 34, iterations: 45, rate: 0.2 })
  // The ridged detail is a crest, and a crest is a single-cell spike until something settles it. The
  // scree pass below is the last one, so the world needs one light pass after it, not only before.
  .smooth({ id: "drift", iterations: 1, strength: 0.12 })
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
  .erode({
    id: "weathering",
    method: "hydraulic",
    droplets: 180000,
    maxSteps: 100,
    inertia: 0.08,
    capacity: 5,
    erosion: 0.16,
    strength: 0.75,
    deposition: 0.28,
    evaporation: 0.025,
  })
  .smooth({ id: "settle", iterations: 1, strength: 0.12 })
  .noise({ id: "detail", base: 0, amplitude: 0.6, scale: 58, warp: 12, octaves: 3, mode: "ridged" })
  // The sea cliff survives because the talus is steep: 38 degrees lets the windward face stand as a
  // face while the gullies feeding it still cut back.
  .erode({ id: "talus", method: "thermal", talus: 38, iterations: 40, rate: 0.2 })
  .smooth({ id: "drift", iterations: 1, strength: 0.12 })
  .materials({
    id: "surfaces",
    rules: [
      { material: "rock", mask: Mask.slope(35, 90, 10) },
      { material: "sand", mask: Mask.height(-1000, 6, 4) },
    ],
  })
  .water({ id: "ocean", kind: "ocean", level: 1.5, radius: 512 });
// Real glaciated granite and bedded sandstone. Only a light transport pass follows the survey:
// no fabricated ridges, shelves, dunes, river cuts or smoothing of the measured landform.
export const alpine = new Terrain({ size: 512, resolution: 257, seed: 41 })
  .heightmap({ id: "usgs-3dep", data: dem.alpine.data })
  .erode({
    id: "surface-runoff",
    method: "hydraulic",
    droplets: 20000,
    maxSteps: 45,
    capacity: 2,
    erosion: 0.015,
    strength: 0.002,
    deposition: 0.2,
    evaporation: 0.035,
  })
  .erode({ id: "loose-talus", method: "thermal", talus: 48, iterations: 1, rate: 0.004 })
  .materials({
    id: "surfaces",
    rules: [
      { material: "rock", mask: Mask.all() },
      { material: "dirt", mask: Mask.slope(20, 38, 6), strength: 0.4 },
      { material: "snow", mask: Mask.and(Mask.height(80, 1e9, 60), Mask.slope(0, 42, 8)) },
    ],
  });
export const desert = new Terrain({ size: 512, resolution: 257, seed: 97 })
  .heightmap({ id: "usgs-3dep", data: dem.desert.data })
  .erode({
    id: "surface-runoff",
    method: "hydraulic",
    droplets: 20000,
    maxSteps: 45,
    capacity: 2,
    erosion: 0.015,
    strength: 0.002,
    deposition: 0.2,
    evaporation: 0.035,
  })
  .erode({ id: "loose-talus", method: "thermal", talus: 60, iterations: 1, rate: 0.004 })
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
  .erode({
    id: "weathering",
    method: "hydraulic",
    droplets: 160000,
    maxSteps: 100,
    capacity: 4,
    erosion: 0.18,
    inertia: 0.07,
    deposition: 0.3,
    evaporation: 0.025,
  })
  .erode({ id: "talus", method: "thermal", talus: 28, iterations: 35, rate: 0.2 })
  .smooth({ id: "settle", iterations: 1, strength: 0.12 })
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
// `pnpm dev` checks the cache on every start; strong erosion runs only on a cold bake. The recipes are seeded and deterministic, so a
// bake is only needed when the recipe, the palette it colours with, or the terrain build it
// evaluates against has changed since the output was written. `bake.mjs --force` overrides.
const recipes = { forest, coastal, alpine, desert, tundra };
// One eroded 5 km field supplies both mountain rings; the runtime only reads its heights.
const continuation = new Terrain({ size: 5000, resolution: 513, seed: 150466 })
  .noise({
    id: "massifs",
    base: 95,
    amplitude: 360,
    scale: 1400,
    warp: 260,
    mode: "fbm",
    octaves: 3,
    persistence: 0.42,
    lacunarity: 2.13,
  })
  .noise({
    id: "spurs",
    amplitude: 145,
    scale: 380,
    warp: 95,
    mode: "ridged",
    octaves: 4,
    persistence: 0.42,
    lacunarity: 2.07,
  })
  .noise({
    id: "couloir-spurs",
    amplitude: 32,
    scale: 110,
    warp: 35,
    mode: "ridged",
    octaves: 3,
    persistence: 0.4,
  })
  .erode({
    id: "drainage",
    method: "hydraulic",
    droplets: 200000,
    maxSteps: 100,
    inertia: 0.05,
    capacity: 7,
    erosion: 0.04,
    deposition: 0.22,
    evaporation: 0.015,
  })
  .erode({
    id: "talus",
    method: "thermal",
    iterations: 18,
    talus: 34,
    rate: 0.2,
    mask: Mask.height(-1e9, 140, 45),
  });
// Forest/coast keep their existing bundle. The other three are separate lazy imports: every
// baked world is a 257-square of heights/colours, so bundling all five would add about 15 MB
// to the initial page module.
const drawn = new Set(["forest", "coastal"]);
const outputDir = new URL("../src/world/", import.meta.url);
const realContinuation = Object.fromEntries(
  ["alpine", "desert"].map((name) => {
    const source = dem[`${name}-horizon`];
    return [
      name,
      new Terrain({ size: source.size, resolution: source.resolution, seed: 1 }).heightmap({
        id: "usgs-surroundings",
        data: source.data,
      }),
    ];
  }),
);
const fingerprint = createHash("sha256")
  .update(
    JSON.stringify(Object.fromEntries(Object.entries(recipes).map(([n, t]) => [n, t.toJSON()]))),
  )
  .update(JSON.stringify(continuation.toJSON()))
  .update(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(realContinuation).map(([name, terrain]) => [name, terrain.toJSON()]),
      ),
    ),
  )
  .update(JSON.stringify(terrainPalette))
  .update(await readFile(new URL(import.meta.url)))
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
        ["baked.json", "horizon.json", ...undrawn.map((name) => `${name}.json`)].map((file) =>
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
  const bakeStarted = performance.now();
  const worlds = {};
  for (const [name, terrain] of Object.entries(recipes)) {
    const started = performance.now();
    const state = terrain.evaluate();
    if (dem[name]) {
      const maxDelta = state.height.reduce(
        (max, height, i) => Math.max(max, Math.abs(height - dem[name].data.values[i])),
        0,
      );
      assert(maxDelta < 1, `${name}: transport changed surveyed geology by ${maxDelta} m`);
      assert.equal(state.waters.length, 0, `${name}: this surveyed crop has no authored water`);
      for (const channel of ["flow", "sediment", "deposition", "talus"]) {
        assert.equal(
          state.erosion?.[channel]?.length,
          state.height.length,
          `${name}: missing ${channel}`,
        );
        assert(state.erosion[channel].every(Number.isFinite), `${name}: nonfinite ${channel}`);
      }
      console.log(`${name}: maximum DEM change ${maxDelta.toFixed(3)} m`);
    }
    const mesh = bakeMesh(state, { palette: terrainPalette });
    worlds[name] = {
      size: state.size,
      resolution: state.resolution,
      heights: Array.from(state.height),
      colors: Array.from(mesh.colors),
      // Actual transport from the installed erosion passes, not a curvature/noise proxy.
      erosion: Object.fromEntries(
        Object.entries(state.erosion ?? {}).map(([key, values]) => [
          key,
          Array.from(values, (value) => Math.round(value * 1000) / 1000),
        ]),
      ),
      rivers: state.rivers,
      waterLevel: state.waters.find((water) => water.kind === "ocean")?.level ?? null,
      lakes: state.waters
        .filter((water) => water.kind === "lake")
        .map(({ id, at, radius, level }) => ({ id, at, radius, level })),
    };
    console.log(
      `${name}: ${((performance.now() - started) / 1000).toFixed(2)} s; ${Buffer.byteLength(JSON.stringify(worlds[name]))} JSON bytes`,
    );
  }
  await mkdir(outputDir, { recursive: true });
  const started = performance.now();
  const distant = continuation.evaluate();
  const horizon = JSON.stringify({
    size: distant.size,
    resolution: distant.resolution,
    heights: Array.from(distant.height, (height) => Math.round(height * 100) / 100),
    ...Object.fromEntries(
      Object.entries(realContinuation).map(([name, terrain]) => {
        const state = terrain.evaluate();
        return [
          name,
          { size: state.size, resolution: state.resolution, heights: Array.from(state.height) },
        ];
      }),
    ),
  });
  await writeFile(new URL("horizon.json", outputDir), horizon);
  console.log(
    `Continuation (forest erosion; alpine/desert DEM): ${((performance.now() - started) / 1000).toFixed(2)} s; ${Buffer.byteLength(horizon)} JSON bytes`,
  );
  await writeFile(
    new URL("../src/world/baked.json", import.meta.url),
    JSON.stringify(Object.fromEntries(Object.entries(worlds).filter(([name]) => drawn.has(name)))),
  );
  for (const [name, world] of Object.entries(worlds))
    if (!drawn.has(name))
      await writeFile(new URL(`${name}.json`, outputDir), JSON.stringify(world));
  await writeFile(new URL(".bake-stamp", outputDir), `${fingerprint}\n`);
  console.log(
    `Cold bake total: ${((performance.now() - bakeStarted) / 1000).toFixed(2)} s; five worlds plus continuation.`,
  );
}

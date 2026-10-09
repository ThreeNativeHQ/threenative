// PRD-466 Phase 4 (box K1): the forest starter kit, adopted the way an agent would adopt it.
//
// A real `minimal` game is scaffolded from this checkout's built dist and installed with the locally
// packed framework tarballs. The kit is then added the way its README says an agent adds it —
// `pnpm add -D` the terrain tarball, copy `starter/forest` into `src/terrain/forest/`, run its bake
// into the game's own asset source — and the game is written around the copied kit. The game
// typechecks, builds for the web, ships a bundle with no authoring package in it, and its own
// playtest scenario walks a player into a fir in a real WebGPU browser.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const GAME_PACKAGES = [
  ["@threenative/core", "core"],
  ["@threenative/physics", "physics"],
  ["@threenative/assets", "assets"],
  ["@threenative/playtest", "playtest"],
  ["create-threenative", "create-threenative"],
];
/** Packed with the rest, installed by the agent step below rather than by the scaffolder. */
const TERRAIN = "@threenative/terrain";
const PORT = 5187;
const REPO = join(import.meta.dirname, "../../..");
const ARTIFACTS = join(import.meta.dirname, "../artifacts/playtest/starter-kit");
const FIXTURES = join(import.meta.dirname, "fixtures/kit-game");

const say = (line) => process.stderr.write(`${line}\n`);

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 1 << 28,
    ...options,
  });
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(" ")} exited ${String(result.status)}:\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  return result.stdout ?? "";
};

/** Total bytes of every file under a directory, or 0 when it does not exist. */
function bytesUnder(directory) {
  if (!existsSync(directory)) return 0;
  let total = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    total += entry.isDirectory() ? bytesUnder(full) : statSync(full).size;
  }
  return total;
}

const round = (value) => Math.round(value * 1_000) / 1_000;

/**
 * The fir the game stands next to, and four metres of clear ground from its trunk.
 *
 * Read out of the bake rather than assumed, so the game never carries a coordinate that only held
 * for one recipe: the recipe's building pad is the ground the bake flattened, so the fir nearest it
 * is on the flattest stand in the world, and the clearest of twenty-four directions at four metres
 * is one that starts no walk inside another prop.
 */
/** Every placed prop in the baked world, read from its placement records. */
function readProps(world) {
  const manifest = JSON.parse(readFileSync(join(world, "world.json"), "utf8"));
  const bytes = readFileSync(join(world, manifest.placements));
  const records = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  const props = [];
  for (const cell of manifest.cells)
    for (const run of cell.runs)
      for (let index = run.offset; index < run.offset + run.count; index += 1)
        props.push({
          asset: run.asset,
          x: records[index * 8],
          y: records[index * 8 + 1],
          z: records[index * 8 + 2],
        });
  return props;
}

function chooseStand(game, world) {
  const props = readProps(world);
  // A baseline run frames the cameras of the run it is compared with (KIT_STAND, JSON).
  if (process.env.KIT_STAND) return standFrom(JSON.parse(process.env.KIT_STAND), props);
  // The lake floods the low ground inside its radius, so the stand, its spawn and the edge camera stay
  // out of that radius plus a margin.
  const lakes = JSON.parse(readFileSync(join(world, "water.json"), "utf8")).lakes;
  const dry = (x, z, margin) =>
    lakes.every((lake) => Math.hypot(x - lake.at[0], z - lake.at[1]) >= lake.radius + margin);
  const firs = props.filter((prop) => prop.asset === "fir" && dry(prop.x, prop.z, 15));
  assert(firs.length > 0, "the bake placed no dry fir to stand next to");
  const layers = JSON.parse(readFileSync(join(game, "src/terrain/forest/recipe.json"), "utf8"))
    .recipe.layers;
  const pad = layers.find((layer) => layer.id === "building-pad")?.params.at ?? [0, 0];
  const fir = nearestTo(firs, pad);
  const others = props.filter((prop) => prop !== fir);
  const { spawn, clearance } = chooseSpawn(fir, others);
  const { edge, edgeClear } = chooseEdge(fir, props, dry);
  return { fir, spawn, clearance, edge, edgeClear };
}

/**
 * The before-state kit: the recipe as it stood before the lake and river were restored, so a baseline
 * renders the same ground without water. Only the game's own copy changes.
 */
function stripWaterLayers(recipePath) {
  const json = JSON.parse(readFileSync(recipePath, "utf8"));
  json.recipe.layers = json.recipe.layers.filter(
    (layer) => !["lake-bed", "river", "lake"].includes(layer.id),
  );
  writeFileSync(recipePath, `${JSON.stringify(json, null, 2)}\n`);
}

/** A baseline has no water to count, so its playtest drops the water rows. */
function stripWaterRows(playtestPath) {
  const json = JSON.parse(readFileSync(playtestPath, "utf8"));
  json.assert.resources = json.assert.resources.filter(
    (row) => !["waterLakes", "waterRivers"].includes(row.path),
  );
  writeFileSync(playtestPath, `${JSON.stringify(json, null, 2)}\n`);
}

/**
 * A stand given by hand. The fir keeps the given point and takes the height of the placement nearest
 * it, so the cameras keep their eye heights.
 */
function standFrom(given, props) {
  const nearest = nearestTo(props, [given.fir.x, given.fir.z]);
  return {
    fir: { x: given.fir.x, y: nearest.y, z: given.fir.z },
    spawn: given.spawn,
    clearance: 0,
    edge: given.edge,
    edgeClear: 0,
  };
}

/** The prop nearest `point` in the ground plane; the first one wins a tie. */
function nearestTo(props, point) {
  return props.reduce((nearest, prop) =>
    Math.hypot(prop.x - point[0], prop.z - point[1]) <
    Math.hypot(nearest.x - point[0], nearest.z - point[1])
      ? prop
      : nearest,
  );
}

/** The clearest of 24 points four metres from the fir's trunk, measured against `others`. */
function chooseSpawn(fir, others) {
  let spawn = { x: fir.x + 4, z: fir.z };
  let clearance = -1;
  for (let step = 0; step < 24; step += 1) {
    const angle = (2 * Math.PI * step) / 24;
    const candidate = { x: fir.x + 4 * Math.cos(angle), z: fir.z + 4 * Math.sin(angle) };
    const clear = Math.min(
      ...others.map((prop) => Math.hypot(prop.x - candidate.x, prop.z - candidate.z)),
    );
    if (clear > clearance) {
      clearance = clear;
      spawn = candidate;
    }
  }
  return { spawn, clearance };
}

/**
 * The edge camera stands back from the stand in the clearest spot 25-40 m out, so it frames the
 * trees instead of sitting inside a crown (crowns reach ~4 m; stands are 4 m apart).
 */
function chooseEdge(fir, props, dry) {
  let edge = { x: fir.x + 30, z: fir.z };
  let edgeClear = -1;
  for (const candidate of edgeCandidates(fir, dry)) {
    const clear = Math.min(
      ...props.map((prop) => Math.hypot(prop.x - candidate.x, prop.z - candidate.z)),
    );
    if (clear > edgeClear) {
      edgeClear = clear;
      edge = candidate;
    }
  }
  return { edge, edgeClear };
}

/**
 * The points the edge camera may use, in the order the search reads them: 24 bearings, 25-40 m out,
 * kept to the sun's side of the stand (the kit's sun azimuth is atan2(0.56, 0.55)) so the view is
 * front-lit like a beauty shot rather than always looking into the light, and inside 250 m.
 */
function edgeCandidates(fir, dry) {
  const sunAzimuth = Math.atan2(0.56, 0.55);
  const candidates = [];
  for (let step = 0; step < 24; step += 1)
    for (const reach of [25, 30, 35, 40]) {
      const angle = (2 * Math.PI * step) / 24;
      const off = Math.abs(Math.atan2(Math.sin(angle - sunAzimuth), Math.cos(angle - sunAzimuth)));
      if (off > Math.PI / 3) continue;
      const candidate = { x: fir.x + reach * Math.cos(angle), z: fir.z + reach * Math.sin(angle) };
      if (Math.abs(candidate.x) > 250 || Math.abs(candidate.z) > 250) continue;
      if (!dry(candidate.x, candidate.z, 5)) continue;
      candidates.push(candidate);
    }
  return candidates;
}

async function main() {
  const temporary = mkdtempSync(join(tmpdir(), "threenative-kit-"));
  say(`kit proof in ${temporary}`);

  // --- pack every package the game needs from this checkout's built output ------------------------
  const packs = join(temporary, "packs");
  mkdirSync(packs);
  const archives = {};
  for (const [name, directory] of [...GAME_PACKAGES, [TERRAIN, "terrain"]]) {
    const before = new Set(readdirSync(packs));
    run("pnpm", ["pack", "--pack-destination", packs], { cwd: join(REPO, "packages", directory) });
    archives[name] = join(
      packs,
      [...readdirSync(packs)].find((file) => !before.has(file)),
    );
  }
  const { createProject } = await import(
    pathToFileURL(join(REPO, "packages/create-threenative/dist/index.js")).href
  );
  const game = (
    await createProject(
      {
        install: true,
        packageSources: Object.fromEntries(GAME_PACKAGES.map(([name]) => [name, archives[name]])),
        target: "kit-game",
        template: "minimal",
      },
      temporary,
    )
  ).target;
  say(`scaffolded ${game}`);

  // --- the agent's own three steps, from the kit's README --------------------------------------------
  run("pnpm", ["add", "-D", archives[TERRAIN]], { cwd: game });
  cpSync(
    join(game, "node_modules", ...TERRAIN.split("/"), "starter/forest"),
    join(game, "src/terrain/forest"),
    {
      recursive: true,
    },
  );
  // A baseline run (KIT_BEFORE=1) bakes the kit as it stood before the lake and river were restored.
  if (process.env.KIT_BEFORE === "1")
    stripWaterLayers(join(game, "src/terrain/forest/recipe.json"));
  const world = join(game, "assets/terrain/forest");
  say(
    `bake: ${run("node", ["src/terrain/forest/bake.mjs", "--out", "assets/terrain/forest"], { cwd: game }).trim()}`,
  );

  const { fir, spawn, clearance, edge, edgeClear } = chooseStand(game, world);
  writeFileSync(
    join(game, "src/terrain/forest/stand.ts"),
    `// Written by the kit's proof from the placements this bake wrote: the fir the scene stands
// next to, four metres of clear ground from its trunk, and the ground it sits on. The scene imports
// this, so no coordinate in the game is one the recipe no longer produces.
export const stand = {
  fir: { x: ${round(fir.x)}, z: ${round(fir.z)} },
  groundY: ${round(fir.y)},
  spawn: { x: ${round(spawn.x)}, z: ${round(spawn.z)} },
  edge: { x: ${round(edge.x)}, z: ${round(edge.z)} },
} as const;
`,
  );
  say(
    `stand: fir ${round(fir.x)},${round(fir.z)} spawn ${round(spawn.x)},${round(spawn.z)} (${round(clearance)} m clear) edge ${round(edge.x)},${round(edge.z)} (${round(edgeClear)} m clear)`,
  );

  // --- the game, written around the copied kit -------------------------------------------------------
  // The scaffold's own arena and its player are the template's files, not this game's; they are the
  // one overwrite, so they are removed rather than left to disagree with the scene's state shape.
  rmSync(join(game, "src/scenes/Play.ts"), { force: true });
  rmSync(join(game, "src/entities"), { force: true, recursive: true });
  for (const name of readdirSync(join(game, "playtests"))) rmSync(join(game, "playtests", name));
  for (const name of ["game.ts", "state.ts"]) cpSync(join(FIXTURES, name), join(game, "src", name));
  cpSync(join(FIXTURES, "playtests/kit.playtest.json"), join(game, "playtests/kit.playtest.json"));
  if (process.env.KIT_BEFORE === "1") stripWaterRows(join(game, "playtests/kit.playtest.json"));
  mkdirSync(join(game, "src/scenes"), { recursive: true });
  cpSync(join(FIXTURES, "Forest.ts"), join(game, "src/scenes/Forest.ts"));
  cpSync(
    join(import.meta.dirname, "../src/render/loading.ts"),
    join(game, "src/render/loading.ts"),
  );
  // loading.ts takes its progress type from this leaf module. Copying propStreaming.ts instead would
  // drag in props.ts and the rest of the preview's render closure, which the game does not ship.
  cpSync(
    join(import.meta.dirname, "../src/render/propProgress.ts"),
    join(game, "src/render/propProgress.ts"),
  );

  // --- it has to typecheck and build, and ship no authoring package ----------------------------------
  run("pnpm", ["typecheck"], { cwd: game });
  say("typecheck ok");
  run("pnpm", ["build:web"], { cwd: game });
  const bundle = join(game, "dist/assets");
  const shipped = readdirSync(bundle)
    .filter((file) => file.endsWith(".js"))
    .map((file) => readFileSync(join(bundle, file), "utf8"))
    .join("\n");
  for (const forbidden of ["@threenative/terrain", "bakeWorldPackage", "terrain-editor"])
    assert(!shipped.includes(forbidden), `the shipped bundle contains '${forbidden}'`);
  const cooked = bytesUnder(join(game, "public/terrain/forest"));
  assert(cooked > 0, "the asset pipeline published nothing under public/terrain/forest");
  say(`built; cooked ${String(cooked)} B under public/terrain/forest`);

  // --- the game's own playtest, against the built bundle, in a real WebGPU browser -------------------
  rmSync(ARTIFACTS, { force: true, recursive: true });
  mkdirSync(ARTIFACTS, { recursive: true });
  const playtest = run(
    "pnpm",
    [
      "exec",
      "threenative-playtest",
      "--scenario",
      "playtests/kit.playtest.json",
      "--url",
      `http://127.0.0.1:${String(PORT)}`,
      "--server-command",
      `pnpm exec vite preview --host 127.0.0.1 --port ${String(PORT)} --strictPort`,
      "--browser-recipe",
      "webgpu",
      "--headed",
      "--artifacts",
      ARTIFACTS,
    ],
    { cwd: game },
  );
  const report = JSON.parse(playtest.slice(playtest.indexOf("{")));
  const failures = (report.assertionResults ?? []).filter((row) => row.pass !== true);
  if (report.pass !== true)
    throw new Error(
      `the kit playtest did not pass:\n${JSON.stringify(failures.slice(0, 12), null, 2)}\n${JSON.stringify(report.diagnostics ?? [], null, 2)}`,
    );
  const capture = JSON.parse(readFileSync(join(ARTIFACTS, "capture.json"), "utf8"));
  assert.equal(capture.rendererKind, "webgpu");
  assert.match(
    capture.adapter.vendor ?? "",
    /nvidia/iu,
    `the run did not reach an NVIDIA adapter: ${JSON.stringify(capture.adapter)}`,
  );

  // --- no failed request (the runner records failures only; locality is the kit spec's static check) ---
  assert(
    Array.isArray(report.observations?.network),
    "the playtest report carries no network record",
  );
  assert.deepEqual(report.observations.network, [], "the game had failed requests");

  const rows = new Map(report.assertionResults.map((row) => [row.id, row.details?.after]));
  const value = (path) => {
    const after = rows.get(`resource.GameState.${path}`);
    assert(after !== undefined, `the playtest asserted nothing at GameState.${path}`);
    return after;
  };
  const perView = (path) => ({
    edge: value(`${path}.edge`),
    ground: value(`${path}.ground`),
    overview: value(`${path}.overview`),
    lake: value(`${path}.lake`),
  });
  const summary = {
    captures: ["edge.png", "ground.png", "lake.png", "overview.png"].map((file) =>
      join("artifacts/playtest/starter-kit", file),
    ),
    closestToTrunk: value("closestToTrunk"),
    cookedForestBytes: cooked,
    driveMetres: value("driveMetres"),
    firInstancesDrawn: value("firInstancesDrawn"),
    frames: value("frames"),
    groundError: value("groundError"),
    adapter: `${capture.adapter.vendor}/${capture.adapter.architecture}`,
    pass: true,
    propColliders: value("propColliders"),
    waterLakes: value("waterLakes"),
    waterRivers: value("waterRivers"),
    views: {
      edge: {
        frameP95: perView("viewFrameP95").edge,
        gpuP50: perView("viewGpuP50").edge,
        gpuP95: perView("viewGpuP95").edge,
      },
      ground: {
        frameP95: perView("viewFrameP95").ground,
        gpuP50: perView("viewGpuP50").ground,
        gpuP95: perView("viewGpuP95").ground,
      },
      overview: {
        frameP95: perView("viewFrameP95").overview,
        gpuP50: perView("viewGpuP50").overview,
        gpuP95: perView("viewGpuP95").overview,
      },
      lake: {
        frameP95: perView("viewFrameP95").lake,
        gpuP50: perView("viewGpuP50").lake,
        gpuP95: perView("viewGpuP95").lake,
      },
    },
  };
  console.log(JSON.stringify(summary));
  // /tmp is RAM here and the scaffold is ~700 MB; a failed run keeps it for inspection.
  if (process.env.KEEP_KIT_GAME === undefined) rmSync(temporary, { force: true, recursive: true });
}

await main();

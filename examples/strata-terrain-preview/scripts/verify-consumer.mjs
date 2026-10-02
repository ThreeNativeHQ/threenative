// Packed-consumer proof for PRD-466 AC-7 and the headless half of AC-8.
//
// Everything the consumer runs resolves from tarballs in a directory outside the workspace graph:
// `pnpm pack` of `@threenative/terrain`, `threenative-engine-mcp` and `create-threenative`, plus the
// `three` the game uses. The consumer therefore sees exactly what a published install would, and any
// import that only works because of a workspace link fails here.
//
// create-threenative is extracted rather than installed: its own dependencies (the asset pipeline)
// are not offline-installable, and what AC-7 needs from it is the files it ships.
//
// It iterates over whatever worlds `scripts/bake.mjs` exports, so a sixth world is covered the day it
// is added.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(".");
const repo = resolve(root, "../..");
const temporary = mkdtempSync(join(tmpdir(), "strata-consumer-"));
const run = (command, args, options = {}) =>
  execFileSync(command, args, { encoding: "utf8", stdio: "pipe", ...options }).trim();

try {
  // --- the worlds this game authors ----------------------------------------------------------------
  // Importing the bake module hands back the seeded recipes; for an unchanged recipe it rewrites the
  // same bytes, and the check at the end proves the tree is as it was.
  const bake = await import("./bake.mjs");
  const recipes = Object.fromEntries(
    Object.entries(bake).filter(([, value]) => typeof value?.toJSON === "function"),
  );
  const worldNames = Object.keys(recipes);
  assert(worldNames.length >= 2, `bake.mjs exported only ${worldNames.join(", ")}`);

  // The arrays the game plays: baked.json holds the drawn worlds, and the rest sit beside it.
  const worldDir = resolve(root, "src/world");
  const baked = JSON.parse(readFileSync(join(worldDir, "baked.json"), "utf8"));
  const bakedHeights = (name) =>
    (baked[name] ?? JSON.parse(readFileSync(join(worldDir, `${name}.json`), "utf8"))).heights;

  // --- pack and install ------------------------------------------------------------------------
  const packed = {};
  const started = performance.now();
  for (const [key, directory] of [
    ["terrain", "packages/terrain"],
    ["mcp", "packages/engine-mcp"],
    ["create", "packages/create-threenative"],
  ]) {
    const before = new Set(readdirSync(temporary));
    run("pnpm", ["pack", "--pack-destination", temporary], { cwd: join(repo, directory) });
    packed[key] = [...readdirSync(temporary)].find((file) => !before.has(file));
    assert(packed[key], `pnpm pack of ${directory} produced no tarball`);
  }
  const require = createRequire(import.meta.url);
  const threeRoot = resolve(dirname(require.resolve("three")), "..");
  packed.three = run(
    "npm",
    ["pack", threeRoot, "--pack-destination", temporary, "--ignore-scripts", "--silent"],
    { cwd: temporary },
  );
  const consumer = join(temporary, "consumer");
  mkdirSync(consumer);
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({ private: true, type: "module", dependencies: {} }),
  );
  run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--offline",
      ...["three", "terrain", "mcp"].map((key) => join(temporary, packed[key])),
    ],
    { cwd: consumer },
  );
  const create = join(temporary, "create-threenative");
  mkdirSync(create);
  run("tar", ["-xzf", join(temporary, packed.create), "-C", create, "--strip-components=1"]);
  const installMs = performance.now() - started;

  // Zero engine dependencies: the consumer's whole node_modules is three, the terrain package, and
  // the capability reader. Nothing of `@threenative/core`, `@threenative/physics` or a renderer.
  const installed = readdirSync(join(consumer, "node_modules")).filter(
    (name) => !name.startsWith("."),
  );
  const scoped = readdirSync(join(consumer, "node_modules/@threenative"));
  assert.deepEqual(scoped, ["terrain"], `Unexpected scoped installs: ${scoped}`);
  assert.deepEqual(installed.sort(), ["@threenative", "three", "threenative-engine-mcp"]);
  const terrainPackage = JSON.parse(
    readFileSync(join(consumer, "node_modules/@threenative/terrain/package.json"), "utf8"),
  );
  assert.deepEqual(Object.keys(terrainPackage.dependencies ?? {}), []);

  // --- AC-7: capability lookup, from the packed install ---------------------------------------------
  const lookup = `
    import { capabilityDetail, searchCapabilities } from "threenative-engine-mcp";
    const manifest = ${JSON.stringify(join(create, "capabilities.json"))};
    const queries = [
      ["request", "a walkable island with seeded noise hills, rivers and scattered trees", "Terrain", "@threenative/terrain"],
      ["mechanic", "procedural heightmap landscape for the game", "Terrain", "@threenative/terrain"],
      ["mechanic", "export the terrain as a glb for another three.js project", "exportWorldGLB", "@threenative/terrain/export"],
      ["mechanic", "open the terrain brush and layer GUI around game-owned rendering", "mountTerrainEditor", "@threenative/terrain/editor"],
    ];
    const found = queries.map(([scope, situation, symbol, importPath]) => {
      const response = searchCapabilities(situation, manifest, scope);
      const hit = response.results.find((result) => result.symbol === symbol);
      if (response.verdict !== "matched" || hit?.importPath !== importPath)
        throw new Error("query did not resolve " + symbol + ": " + JSON.stringify(response.results.map((r) => r.symbol + "@" + r.importPath)));
      return { symbol, importPath, rank: response.results.indexOf(hit) };
    });
    console.log(JSON.stringify({ found, terrain: capabilityDetail("Terrain", manifest) }));
  `;
  writeFileSync(join(consumer, "lookup.mjs"), lookup);
  const lookedUp = JSON.parse(run("node", ["lookup.mjs"], { cwd: consumer }));
  const constraints = JSON.stringify(lookedUp.terrain.constraints ?? lookedUp.terrain);
  for (const truth of [
    "metres",
    "4294967295",
    "17, 33, 65, 129, 257, 513 or 1025",
    "synchronous",
    "materials, models and texture paths belong to the game",
  ])
    assert(constraints.includes(truth), `Terrain's packed constraints lack: ${truth}`);

  // The scaffold's shipped instructions, from the packed create-threenative.
  const templates = readdirSync(join(create, "templates"), { withFileTypes: true }).filter(
    (entry) => entry.isDirectory(),
  );
  assert(templates.length >= 11, `Expected the eleven templates, found ${templates.length}`);
  for (const { name } of templates) {
    for (const file of ["AGENTS.md", "CLAUDE.md"])
      assert(
        readFileSync(join(create, "templates", name, file), "utf8").includes(
          "agent-docs/references/terrain-authoring.md",
        ),
        `${name}/${file} does not point at the terrain workflow`,
      );
    const manifestJson = JSON.parse(readFileSync(join(create, "templates", name, "package.json")));
    assert(
      !(
        "@threenative/terrain" in { ...manifestJson.dependencies, ...manifestJson.devDependencies }
      ),
      `${name} makes the authoring addon an ordinary runtime dependency`,
    );
  }
  // A fresh project, not just the template tree: the scaffold that `create-threenative` writes
  // carries the same pointer, in both instruction files, and no authoring dependency.
  const { createProject } = await import(
    pathToFileURL(join(repo, "packages/create-threenative/dist/index.js")).href
  );
  const fresh = await createProject(
    { install: false, target: "fresh-game", template: "minimal" },
    temporary,
  );
  for (const file of ["AGENTS.md", "CLAUDE.md"])
    assert(
      readFileSync(join(fresh.target, file), "utf8").includes(
        "agent-docs/references/terrain-authoring.md",
      ),
      `A fresh scaffold's ${file} does not point at the terrain workflow`,
    );
  const freshPackage = JSON.parse(readFileSync(join(fresh.target, "package.json"), "utf8"));
  assert(
    !("@threenative/terrain" in { ...freshPackage.dependencies, ...freshPackage.devDependencies }),
    "A fresh scaffold depends on the authoring addon",
  );
  const workflow = readFileSync(join(create, "agent-docs/references/terrain-authoring.md"), "utf8");
  for (const required of [
    "npm install --save-dev @threenative/terrain",
    "@threenative/terrain/editor/server",
    "exportWorldGLB",
    "node_modules/@threenative/terrain/AGENT_GUIDE.md",
  ])
    assert(workflow.includes(required), `The shipped terrain workflow lacks: ${required}`);
  readFileSync(join(consumer, "node_modules/@threenative/terrain/AGENT_GUIDE.md"), "utf8");

  // --- AC-8, headless half: author, bake and load through public imports --------------------------
  writeFileSync(
    join(consumer, "recipes.json"),
    JSON.stringify(Object.fromEntries(worldNames.map((name) => [name, recipes[name].toJSON()]))),
  );
  const author = `
    import { createHash } from "node:crypto";
    import { readFileSync, writeFileSync } from "node:fs";
    import { Terrain, bakeMesh, encodeGLB } from "@threenative/terrain";
    import * as editor from "@threenative/terrain/editor";
    import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
    import { Box3 } from "three";
    if (typeof editor.mountTerrainEditor !== "function" || typeof editor.TerrainEditorController !== "function")
      throw new Error("The packed editor entry does not export the editor");
    const recipes = JSON.parse(readFileSync("recipes.json", "utf8"));
    const report = [];
    for (const [world, recipe] of Object.entries(recipes)) {
      const t0 = performance.now();
      const state = Terrain.fromJSON(recipe).evaluate();
      const evaluateMs = performance.now() - t0;
      const t1 = performance.now();
      const glb = encodeGLB(bakeMesh(state));
      const exportMs = performance.now() - t1;
      writeFileSync(world + ".glb", glb);
      const bytes = Buffer.from(glb);
      const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString("utf8"));
      const gltf = await new Promise((resolve, reject) =>
        new GLTFLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "", resolve, reject));
      let meshes = 0, triangles = 0;
      gltf.scene.traverse((object) => {
        if (!object.isMesh) return;
        meshes++;
        triangles += (object.geometry.index?.count ?? object.geometry.getAttribute("position").count) / 3;
      });
      const box = new Box3().setFromObject(gltf.scene);
      report.push({
        world,
        resolution: state.resolution,
        size: state.size,
        heightsSha: createHash("sha256").update(JSON.stringify(Array.from(state.height))).digest("hex"),
        heights: Array.from(state.height).length,
        minY: box.min.y, maxY: box.max.y, spanX: box.max.x - box.min.x, spanZ: box.max.z - box.min.z,
        stateMin: Math.min(...state.height), stateMax: Math.max(...state.height),
        meshes, triangles,
        externalUris: [...(json.buffers ?? []), ...(json.images ?? [])].filter((entry) => entry.uri).length,
        requiredExtensions: json.extensionsRequired ?? [],
        glbBytes: bytes.length, evaluateMs, exportMs,
      });
    }
    console.log(JSON.stringify(report));
  `;
  writeFileSync(join(consumer, "author.mjs"), author);
  const authored = JSON.parse(run("node", ["author.mjs"], { cwd: consumer }));
  assert.equal(authored.length, worldNames.length);
  for (const entry of authored) {
    const sha = (heights) => createHash("sha256").update(JSON.stringify(heights)).digest("hex");
    assert.equal(
      entry.heightsSha,
      sha(bakedHeights(entry.world)),
      `${entry.world}: the packed package's heights are not the arrays the game plays`,
    );
    assert.equal(entry.heights, entry.resolution ** 2);
    assert.equal(entry.triangles, 2 * (entry.resolution - 1) ** 2, `${entry.world} triangles`);
    assert(entry.meshes >= 1, `${entry.world}: the GLB loaded no mesh`);
    assert(Math.abs(entry.spanX - entry.size) < 1e-3 && Math.abs(entry.spanZ - entry.size) < 1e-3);
    assert(
      Math.abs(entry.minY - entry.stateMin) < 1e-3 && Math.abs(entry.maxY - entry.stateMax) < 1e-3,
    );
    assert.equal(entry.externalUris, 0, `${entry.world}: the GLB names an external file`);
    assert.deepEqual(entry.requiredExtensions, []);
    assert.equal(entry.world.length > 0, true);
  }

  console.log(
    JSON.stringify({
      consumer: {
        installMs: Math.round(installMs),
        installed: ["three", ...scoped, "threenative-engine-mcp"],
      },
      capabilities: lookedUp.found,
      templatesChecked: templates.length,
      freshScaffold: fresh.target.split("/").at(-1),
      worlds: authored.map((entry) => ({
        world: entry.world,
        heights: entry.heights,
        triangles: entry.triangles,
        glbBytes: entry.glbBytes,
        evaluateMs: Math.round(entry.evaluateMs),
        exportMs: Math.round(entry.exportMs),
      })),
    }),
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

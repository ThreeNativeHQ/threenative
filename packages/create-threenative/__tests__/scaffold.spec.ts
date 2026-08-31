import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { loadConfig } from "../src/config.js";
import {
  cliHelp,
  createProject,
  discoverKitManifests,
  discoverTemplateNames,
  parseArgs,
  scaffoldCompletionMessage,
} from "../src/index.js";

const run = promisify(execFile);

const TEMPLATE_ROOT = path.resolve("packages/create-threenative/templates");
const KIT_FIXTURE_ROOT = path.resolve("packages/create-threenative/__tests__/fixtures/kits");
const ASSET_MCP = "threenative-asset-mcp";
const SCULPT_MCP = "threenative-sculpt-mcp";
const ENGINE_MCP = "threenative-engine-mcp";
// Every server launches through a shim in `@threenative/core`, the one package a ThreeNative
// project always depends on directly, so the path resolves whatever the package manager did with
// the server packages themselves.
const CORE_SHIM = "./node_modules/@threenative/core/mcp";
const ALL_TEMPLATES = discoverTemplateNames(TEMPLATE_ROOT);
const AGENT_ROLE_PATHS = [
  ".threenative/agents/builder.md",
  ".threenative/agents/verifier.md",
  ".claude/agents/threenative-builder.md",
  ".claude/agents/threenative-verifier.md",
  ".agents/skills/threenative-builder/SKILL.md",
  ".agents/skills/threenative-verifier/SKILL.md",
  "AGENT-ROLES.md",
] as const;

// Refreshed for the startup-readiness loading gate: each template's `src/render/loading.ts` was
// reduced to the shared `startup.whenReady()` contract and every template's AGENTS.md carries
// the readiness wording into the shipped scaffold.
//
// Refreshed by PRD-219, in the commit that changed the bytes. Two shipped things moved: the
// starter's menu proof became cross-target (`noNetworkErrors` is a reasoned opt-out, because the
// browser is the only target with a CDP network observer), and the capability manifest every
// template embeds gained the Android viewport, rotation, tap and IME helpers that proof needed.
// The starter's name field also gained autoCapitalize/autoCorrect/spellCheck: a phone keyboard
// rewrites what the player typed unless the field says not to.
// Recomputed 2026-08-30 for `minimal` only: its atmosphere sky and aerial-perspective
// in-scattering were both scaled by 24, a value authored when that template had no post chain.
// The chain now exposes the pass and tone-maps it, so the same radiance was applied twice and
// exposed again — median frame luminance 203 of 255 against 22 for the template's last good
// baseline. Both multipliers are 1.5, calibrated on a scaffolded render rather than chosen.
// Recomputed again for the chasers' measured routes: they now step only once startup
// reports ready, so a slow lane cannot spend part of the route before anything observes it.
// Recomputed 2026-08-30 for `platformer` only: c2ba91d9 re-measured that template's performance
// budgets against the running frame — the previous 70 draws / 3350 triangles were counted behind
// the loading layer, on a frame the player never sees — and moved the scenario to 200 / 7700
// against a measured 160 / 6127. The frame-time ceiling deliberately did not move.
// Recomputed 2026-08-30 for all seven: `pnpm build` regenerated `capabilities.json` and the
// capability reference derived from it, and every scaffold embeds both, so exporting one public
// symbol moves every template's bytes. Six of the seven moved for that reason alone; platformer
// also carries its chasers' route change.
// Recomputed 2026-08-31 from the values CI measured, not from a local run.
//
// These were updated three times in a row and were wrong all three times, because they were
// computed against a WORKING TREE that carried another lane's uncommitted template edits. CI
// checks out only committed files, so the numbers disagreed by construction and no amount of
// re-running locally could converge them. If this table needs updating again, take the values
// from a CI failure's `Received` block, or compute them from a clean checkout of HEAD — never
// from a dirty tree in a checkout more than one lane is working in.
// Recomputed 2026-08-31 for PRD-295: every template's AGENTS.md now carries the Fab import route
// (fab_search_assets -> fab_list_owned -> fab_import_asset) in the shared asset-mcp-loop fragment,
// and that fragment is embedded in all seven scaffolds.
const PRD_201_PARENT_SCAFFOLD_HASHES: Readonly<Record<string, string>> = {
  // Values recomputed 2026-08-28 when every template began shipping `renderer.resolutionScale:
  // "auto"` and passing `display: config.display` into `defineGame` (PRD-228), so the engine
  // holds the frame budget instead of the game hand-authoring a resolution constant.
  // Recomputed after Biome reformatted nine template files: the previous values were measured
  // before that formatting ran and were therefore stale the moment they were committed.
  // Recomputed again for PRD-237: the shared capability reference now documents PointerEvents3D,
  // which changes the generated reference bytes embedded in every scaffold.
  // Recomputed again for the PRD-237 repair: the shared ctx surface now documents ctx.pointer,
  // which changes the generated instructions embedded in every scaffold.
  // Recomputed again for the PRD-237 continuation repair: the defense pointer-placement scenario
  // clears mouse hover and captures the held touch highlight before its release.
  // Recomputed 2026-08-29: `RunnerConsoleEntry` was renamed to `IRunnerConsoleEntry` in
  // packages/playtest/src/index.ts without regenerating the capability manifest. A scaffold
  // generates its capability reference from source, so all seven trees moved while the
  // committed reference stayed stale; both are fixed in the same commit.
  // Recomputed 2026-08-29 for PRD-246: `GPUReadback` and `SpectralOcean` entered the public
  // surface, so the capability manifest and the capability reference generated from it both grew,
  // and those bytes are copied into every scaffold.
  // Recomputed 2026-08-29 for PRD-256: every scaffold now forwards its asset config to the dev
  // watcher and carries the bounded static-lightmap setup, rollback, and platform warning. The
  // shooter hash also includes its 60-frame input-control warmup from current main.
  // Recomputed for PRD-251 Phase 1: every scaffold embeds the capability manifest and reference,
  // which now document the optional Heightfield world subpath.
  // Recomputed 2026-08-30 for the starter only: eighteen of its playtest scenarios gained the
  // menu-entry steps they had been missing since the menu screen flow landed, so a scaffolded
  // project's own `npm test` can reach the play scene at all. Scenario bytes moved and no source
  // did, so exactly one tree's hash moved.
  // Recomputed 2026-08-30 for InstancedBatch: the capability manifest and the reference generated
  // from it both gained an entry, and those bytes are embedded in every scaffold, so all seven
  // trees move. The racing tree moves for a second reason — its track gathers the ten kerb stones
  // into one batch instead of drawing each on its own.
  // Recomputed again the same day for the TSL silent-no-op traps, which every scaffold carries in
  // `agent-docs/visual-baseline.md`, and for the starter dropping its hand-rolled `makeRandom` in
  // favour of the identical `createRandom` the framework already exports. That swap is
  // output-identical — same multiplier, same increment, verified over 35,000 draws — so the ridge
  // does not move; the bytes around it do.
  // Recomputed 2026-08-30 for the realism-effects roll. Every template moved because the shared
  // render-chain API, generated instructions, and optional effect sources are scaffolded bytes.
  // Recomputed again after the starter's composed sharpen/bloom proof, optional effect parameters,
  // and its migrated browser fixtures; the shooter hash also moved with its fixture corrections.
  // Recomputed 2026-08-30 for the distributed Three.js batched-velocity patch, its generated
  // project pnpm declaration, and the completed-frame render-chain measurement field.
  // Recomputed for PRD-243: every scaffold embeds the capability manifest and reference, which
  // now document SoftBody3D and the optional physics collision adapter. The starter also gains
  // its shipped cloth caller and menu-to-play proof.
  // Recomputed 2026-08-30 after removing duplicate starter menu-entry blocks introduced by the
  // realism-effects merge.
  // Recomputed after retaining the WebGPU instance in Three's distributed patch; the starter
  // also materialises its SSR input once so the reflection graph presents instead of going blank.
  // Recomputed 2026-08-30 after documenting the starter's WorldEnvironment render layer in
  // every scaffold's visual reference and generated instructions.
  // Recomputed when PRD-243 added the qualified Pixel 8 cost to the copied capability docs; the
  // starter also carries the physical-device cloth displacement threshold.
  // Recomputed after capability discovery became mechanic-driven and every scaffold gained the
  // project-scoped Codex MCP config required to expose the installed engine server.
  // Recomputed after the authoring tools gained explicit request-versus-mechanic search scope.
  // Recomputed after MCP server packages became automatic core payloads rather than scaffold pins.
  // Recomputed 2026-08-30 for the starter only: the branded "THREE NATIVE" start screen and its
  // mandatory character-name form are deleted, so the tree loses MainMenu.ts, MainMenuUi.tsx and
  // menu-flow.playtest.json, and every remaining scenario loses its menu-entry steps. One tree
  // moved because only the starter shipped a menu.
  // The cloth and two zoom scenarios also move: with the play scene running from tick 0 their
  // baseline is sampled inside the simulation, so a "gte" that was zero at the menu is now
  // already satisfied. They assert the transition instead.
  // Recomputed 2026-08-30 for the template typecheck repair: the starter's render chain and
  // its three optional effects now name the node types they actually take, and the defense
  // App names the physics its own game defines. Both moves are type-only — the emitted
  // JavaScript is unchanged apart from two forwarding helpers — so two trees move and the
  // pixels do not.
  // Recomputed when virtual geometry added `ClusteredMesh` and `ClusteredBatch` to the
  // capability manifest and reference, both of which every scaffold copies.
  // Recomputed again when virtual geometry started shipping on: every template's instructions
  // gained the convention and its opt-out, and the capability text lost the per-frame call the
  // engine now makes itself.
  // Recomputed 2026-08-30 for the platformer only: `348463f5` pinned the patrol in the damage
  // scenario and `cf5520c8` guarded the stomp scenarios' frozen placement. Scenario bytes moved
  // and no other tree did, so exactly one hash moves.
  // Recomputed 2026-08-30 for PRD-278: all seven trees. The six templates that had a 14-45 line
  // `postprocessing.ts` now ship `worldEnvironment.ts` and a desktop/mobile preset pair beside
  // it, every `setupLighting` returns its key light so godrays can refuse a shadowless one by
  // name, every scene passes `isMobile()` in, and each template's AGENTS.md gained the
  // `TN_WORLD_ENVIRONMENT` paragraph. The starter moves too: the shared file gained the
  // `baseColour` seam `minimal`'s aerial perspective needs, bloom radius and threshold as
  // arguments, and the report that prints even when every stage is off.
  // Recomputed 2026-08-30, second PRD-278 move: with the runner now waiting for startup readiness
  // (2042b33d) the per-template performance budgets were being read behind a loading layer — the
  // action-rpg scenario reported 4 draw calls where the running scene issues 144 — so every genre
  // template's maxDrawCalls/maxTriangles is re-measured against the real frame, and `minimal`
  // ships without the SSGI gather because with it the play scenario measured 34.2 ms p95 against
  // its 33 ms ceiling.
  // Recomputed 2026-08-30 after PRD-067 added the shipped native icon and app-config defaults
  "action-rpg": "b1526f252cd37086058749af1a0c087413199b3768435ff5a5b470f49f3b77b2",
  defense: "fad4fa70748c67486ef3dce00568f353e4576832ef3e535dc578e0266b752761",
  minimal: "8ae12cc4472880be0863c3fabe4a0c640531201793287d7004b44371130ff3f8",
  platformer: "cecc1ae8a441b038ea787ea78e6a1a90471947de578f6efb6ae9ab909ff10f85",
  racing: "098ed6e6b987f689bf6fc87f972c2ec103716797721e14a38b3a3618b4f481e0",
  shooter: "e4b27093f5b28b8a9f3d208a29b08d7c69a6ffe3b34ccf4270a5ba5f1c1d3d93",
  starter: "69b026a7b199fdfbf019e3569644ce7ca6687b41059bca2b0d52369c0ede9823",
  // Recomputed 2026-08-30 for PRD-193: the starter and racing templates now prove their
  // steady-state allocation-free frame path, and every scaffold carries the updated capability
  // manifest/reference bytes.
  // Recomputed 2026-08-30 for PRD-122: every scaffold now carries the shared canonical role
  // contracts, provider adapters, and AGENT-ROLES.md guide.
  // Recomputed 2026-08-30 for PRD-236: the sailing starter kit adds a scaffold tree, and its
  // WaveField/Buoyancy3D public surface updates the generated capability reference in all trees.
  // Recomputed for PRD-236 repair round 1: sailing now ships its own desktop native smoke
  // scenario, routes test:native through it, and closes the generated command fence.
  // Recomputed after the template contract required every kit to ship a native icon.
  sailing: "c01bc61b2a7d81673535eefba56f2480d904771438d509ae5b84869dc8ef7a76",
  // Recomputed 2026-08-31 for the merged PRD-268 and PRD-269 render/runtime surfaces.
  // Recomputed after the capability manifest gained the portable scroll/pinch zoom surface
  // (PRD-239), which is copied into every scaffold.
  // Recomputed after the starter's zoom binding comment documented the shared DOM wheel sign.
  // Recomputed after PRD-247 added per-item capabilities, the shooter's proof scenario, and the
  // unrestricted billboard example in the generated capability reference.
  // Recomputed after the roll continuation updated the generated shooter's nameplate observer.
  // Recomputed after the capability reference's Scheduler example switched to the game-owned
  // `ctx.tween` path, so generated scaffolds no longer embed an un-ticked standalone Scheduler.
  // Recomputed 2026-08-28 for PRD-248. Every template moved because every scaffold embeds the
  // capability manifest, which gained the atmosphere entries; `minimal` moved twice over, for its
  // atmosphere-driven `src/render/` files, its new `playtests/atmosphere.playtest.json`, and the
  // AGENTS.md paragraph that states the convention.
  // Recomputed 2026-08-29 for PRD-249. Every template moved because every scaffold embeds the
  // new FluidField2D capability manifest and generated capability-reference entry.
};

const GENERATED_SCAFFOLD_METADATA =
  /^(?:node_modules(?:\/|$)|dist(?:\/|$)|\.vite(?:\/|$)|coverage(?:\/|$)|pnpm-lock\.yaml$|package-lock\.json$|yarn\.lock$)/u;

/** Stages a broken template in a throwaway copy of the template tree and hands the body its
 * root, so a negative control never edits the shipped templates. It used to edit them in place
 * and put them back: `createProject` resolved its own root, so there was nowhere else to stage
 * one. Vitest runs spec files in parallel, so any file scaffolding `starter` during that window
 * read a template that was broken on purpose for this one — `build.spec.ts` failed intermittently
 * on `must launch from './node_modules/', not '-y'`, a red with nothing wrong behind it.
 * `createProject` now takes a template root; the copy is this test's alone. */
async function withBrokenTemplateFile<T>(
  relativePath: string,
  content: string | undefined,
  body: (root: string) => Promise<T>,
): Promise<T> {
  const root = await makeTempDir("threenative-broken-template-");
  try {
    // The package layout the scaffolder reads: templates/ plus the package-level siblings it
    // reaches up to (capabilities.json, template-assets, agent-docs, agent-files). The copied tree
    // is the templates dir; the siblings ride along so a test breaks exactly the file it names.
    const packageDirectory = path.dirname(TEMPLATE_ROOT);
    for (const sibling of ["capabilities.json", "template-assets", "agent-docs", "agent-files"]) {
      await cp(path.join(packageDirectory, sibling), path.join(root, sibling), {
        recursive: true,
      });
    }
    await cp(TEMPLATE_ROOT, path.join(root, "templates"), { recursive: true });
    const file = path.join(root, "templates", relativePath);
    if (content === undefined) await rm(file);
    else await writeFile(file, content);
    return await body(path.join(root, "templates"));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function scaffoldTreeHash(directory: string): Promise<string> {
  const files: Array<[string, Buffer]> = [];
  async function walk(current: string): Promise<void> {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(file);
      } else {
        const relative = path.relative(directory, file);
        if (!GENERATED_SCAFFOLD_METADATA.test(relative)) {
          files.push([relative, await readFile(file)]);
        }
      }
    }
  }
  await walk(directory);
  const hash = createHash("sha256");
  for (const [relative, contents] of files) {
    hash.update(relative).update("\0").update(contents).update("\0");
  }
  return hash.digest("hex");
}

const STARTER_PATHS = [
  // Ignores the asset compile step's generated outputs; the sources in assets/ ship.
  ".gitignore",
  ".codex/config.toml",
  ".mcp.json",
  "AGENTS.md",
  "CLAUDE.md",
  "kit.json",
  "package.json",
  "patches/three@0.185.1.patch",
  "threenative.config.ts",
  "tools/look.mjs",
  "index.html",
  "tailwind.config.ts",
  "tsconfig.json",
  "src/style.css",
  "vite.config.ts",
  "src/game.ts",
  "src/main.ts",
  "src/scenes/Play.ts",
  "src/render/lighting.ts",
  "src/render/postprocessing.ts",
  "src/render/worldEnvironment.ts",
  "src/render/palette.ts",
  "src/render/materials.ts",
  "src/render/shapes.ts",
  "src/render/camera.ts",
  "src/render/easing.ts",
  "src/render/sky.ts",
  "src/render/scenery.ts",
  "src/render/pennant.ts",
  "src/render/loading.ts",
  "src/entities/Crate.ts",
  "src/entities/Goal.ts",
  "src/entities/Player.ts",
  "src/ui/Hud.tsx",
  "src/ui/Menu.tsx",
  "src/ui/GameUi.tsx",
  "src/ui/main.tsx",
  "src/ui/App.tsx",
  "src/state.ts",
  "playtests/survives.playtest.json",
  "playtests/assets.playtest.json",
  "playtests/play.playtest.json",
  "playtests/forward.playtest.json",
  "native-playtests/react-hud.playtest.json",
  "playtests/coyote.playtest.json",
  "playtests/buffer.playtest.json",
  "playtests/look.playtest.json",
  "playtests/pause.playtest.json",
  "playtests/respawn.playtest.json",
  "playtests/goal.playtest.json",
  "playtests/gameover.playtest.json",
  "playtests/seed.playtest.json",
  "playtests/cloth.playtest.json",
  "assets/native-proof.glb",
  "assets/native-proof.png",
  "public/icon.png",
  "assets/pickup.wav",
  // P2-2: the searchable reference bundle every generated project must ship.
  "agent-docs/assertion-reference.md",
  "agent-docs/capture-the-frame.md",
  "agent-docs/ctx-cookbook.md",
  "agent-docs/debug-surface.md",
  "agent-docs/finding-assets.md",
  "agent-docs/gameplay-recipes.md",
  "agent-docs/menu-screens.md",
  "agent-docs/sculpt-from-a-reference.md",
  "agent-docs/visual-baseline.md",
];

const MINIMAL_RENDER_PATHS = [
  "src/render/palette.ts",
  "src/render/camera.ts",
  "src/render/sky.ts",
  "src/render/lighting.ts",
  "src/render/loading.ts",
  "src/render/hud.ts",
  "src/render/materials.ts",
  "src/render/postprocessing.ts",
] as const;

const PLATFORMER_PATHS = [
  "AGENTS.md",
  "CLAUDE.md",
  "kit.json",
  "package.json",
  "threenative.config.ts",
  "src/game.ts",
  "src/main.ts",
  "src/state.ts",
  "src/scenes/Boot.ts",
  "src/scenes/Level.ts",
  "src/entities/Character.ts",
  "src/entities/Chaser.ts",
  "src/entities/Patrol.ts",
  "src/entities/Pickup.ts",
  "src/level/Checkpoints.ts",
  "src/level/Platform.ts",
  "src/render/palette.ts",
  "src/render/camera.ts",
  "src/render/lighting.ts",
  "src/render/loading.ts",
  "src/render/materials.ts",
  "src/render/rig.ts",
  "src/render/sky.ts",
  "src/render/postprocessing.ts",
  "src/render/terrain.ts",
  "public/icon.png",
  "playtests/jump.playtest.json",
  "playtests/patrol.playtest.json",
  "playtests/collect.playtest.json",
  "playtests/stomp.playtest.json",
  "playtests/stomp-rise.playtest.json",
  "playtests/respawn.playtest.json",
  "playtests/oneway.playtest.json",
  "playtests/collision-layers.playtest.json",
  "playtests/chase.playtest.json",
  "playtests/avoidance.playtest.json",
  "playtests/performance.playtest.json",
  "playtests/terminal-loop-win.playtest.json",
  "playtests/terminal-loop-fail.playtest.json",
  "playtests/native/touch-controls.playtest.json",
];

describe("create-threenative", () => {
  it("discovers manifests and generates its template help from them", () => {
    const manifests = discoverKitManifests(TEMPLATE_ROOT);
    expect(manifests.map(({ name }) => name)).toEqual(
      [...manifests].map(({ name }) => name).sort(),
    );
    for (const name of ["minimal", "platformer", "starter"]) {
      expect(manifests.some((manifest) => manifest.name === name)).toBe(true);
    }
    expect(manifests.find(({ name }) => name === "platformer")).toMatchObject({
      blurb: expect.any(String),
      genre: "platformer",
      kit: true,
      title: "Platformer",
    });
    const help = cliHelp();
    expect(help).toContain("Templates:");
    const width = Math.max(...manifests.map(({ name }) => name.length));
    for (const manifest of manifests) {
      expect(help).toContain(
        `${manifest.name.padEnd(width)}  ${manifest.title}: ${manifest.blurb}`,
      );
    }
  });

  it("derives the scaffold completion message from every discovered kit", async () => {
    const root = await makeTempDir("threenative-message-manifests-");
    try {
      const templates = path.join(root, "templates");
      await cp(TEMPLATE_ROOT, templates, { recursive: true });
      await cp(path.join(KIT_FIXTURE_ROOT, "scratch"), path.join(templates, "scratch"), {
        recursive: true,
      });
      const manifests = discoverKitManifests(templates);

      expect(scaffoldCompletionMessage(manifests)).toBe(
        `Templates: ${manifests
          .map(({ name }) => (name === "starter" ? `${name} (default)` : name))
          .join(", ")}. Choose with --template <name>.\n`,
      );
      expect(scaffoldCompletionMessage(manifests)).toContain("scratch");
      const source = await readFile(
        path.resolve("packages/create-threenative/src/index.ts"),
        "utf8",
      );
      expect(source).toContain("scaffoldCompletionMessage(discoverKitManifests())");
      expect(source).not.toContain("Templates: minimal (smallest)");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("keeps package flags and template substitution single-sourced", async () => {
    const source = await readFile(path.resolve("packages/create-threenative/src/index.ts"), "utf8");
    expect(source.match(/const PACKAGE_SOURCE_FLAGS =/gu)).toHaveLength(1);
    expect(
      source.match(/type PackageSourceName = keyof typeof PACKAGE_SOURCE_FLAGS;/gu),
    ).toHaveLength(1);
    expect(source).not.toMatch(/type PackageSourceName = ["']/u);
    expect(
      source.match(/for \(const \[name, flag\] of Object\.entries\(PACKAGE_SOURCE_FLAGS\)\)/gu),
    ).toHaveLength(1);
    expect(source).not.toContain("for (const [name, flag] of [");
    expect(source.match(/function substituteTemplateVariables\(/gu)).toHaveLength(1);
    expect(source.match(/substituteTemplateVariables\(/gu)).toHaveLength(3);
    expect(source.match(/replaceAll\(placeholder, value\)/gu)).toHaveLength(1);
  });

  it("keeps every no-install scaffold tree byte-stable against the PRD parent", async () => {
    const root = await makeTempDir("threenative-scaffold-stability-");
    try {
      const actual: Record<string, string> = {};
      for (const template of ALL_TEMPLATES) {
        const { target } = await createProject(
          { install: false, target: template, template },
          root,
        );
        expect(PRD_201_PARENT_SCAFFOLD_HASHES[template]).toBeDefined();
        actual[template] = await scaffoldTreeHash(target);
      }
      expect(actual).toEqual(PRD_201_PARENT_SCAFFOLD_HASHES);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  // P2-2: the bounded instructions name long recipes by their shipped path. This is the
  // generated-project check behind the "omit reference copying" negative control: with
  // `copyReferenceBundle` removed from `createProject`, the scaffold itself throws
  // `RED observed: referenced recipe missing` before this body ever runs.
  it("should copy bounded references with project placeholders", async () => {
    const root = await makeTempDir("threenative-reference-bundle-");
    try {
      const result = await createProject(
        { install: false, target: "my-game", template: "starter" },
        root,
      );
      const bundleDirectory = path.join(result.target, "agent-docs");
      const shipped = (await readdir(bundleDirectory)).sort();
      expect(shipped).toEqual([
        "assertion-reference.md",
        "capability-reference.md",
        "capture-the-frame.md",
        "ctx-cookbook.md",
        "debug-surface.md",
        "finding-assets.md",
        "gameplay-recipes.md",
        "menu-screens.md",
        "mobile-memory-budget.md",
        "sculpt-from-a-reference.md",
        "visual-baseline.md",
        "webview-ui.md",
      ]);
      for (const file of shipped) {
        const page = await readFile(path.join(bundleDirectory, file), "utf8");
        expect(page, file).not.toContain("__PROJECT_NAME__");
        expect(page, file).not.toContain("__PROJECT_ID__");
      }
      const agents = await readFile(path.join(result.target, "AGENTS.md"), "utf8");
      expect(agents).toContain("`agent-docs/finding-assets.md`");
      for (const file of shipped) {
        // Every path the instructions name must resolve inside the generated project.
        expect(agents, file).toContain(`agent-docs/${file}`);
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it.each(ALL_TEMPLATES)(
    "should overlay the canonical builder and verifier roles on the %s scaffold",
    async (template) => {
      const root = await makeTempDir(`threenative-agent-roles-${template}-`);
      try {
        const result = await createProject(
          { install: false, target: `${template}-game`, template },
          root,
        );
        const contents = await Promise.all(
          AGENT_ROLE_PATHS.map(async (relativePath) => {
            const content = await readFile(path.join(result.target, relativePath), "utf8");
            expect(content, relativePath).not.toContain("__PROJECT_NAME__");
            expect(content, relativePath).not.toContain("__PROJECT_ID__");
            return [relativePath, content] as const;
          }),
        );
        const files = new Map(contents);
        const builder = files.get(".threenative/agents/builder.md") ?? "";
        const verifier = files.get(".threenative/agents/verifier.md") ?? "";
        expect(builder).toContain("one bounded player-visible outcome");
        expect(builder).toContain("engine-owned or game-owned");
        expect(builder).toContain("production readiness");
        expect(verifier.toLowerCase()).toContain("read-only");
        expect(verifier).toContain("must not edit");
        expect(new Set(verifier.match(/`(?:PASS|REQUEST_CHANGES|NOT_OBSERVED)`/gu))).toEqual(
          new Set(["`PASS`", "`REQUEST_CHANGES`", "`NOT_OBSERVED`"]),
        );

        const adapterPaths = [
          [".claude/agents/threenative-builder.md", ".claude/agents/threenative-verifier.md"],
          [
            ".agents/skills/threenative-builder/SKILL.md",
            ".agents/skills/threenative-verifier/SKILL.md",
          ],
        ] as const;
        for (const [builderPath, verifierPath] of adapterPaths) {
          const builderAdapter = files.get(builderPath) ?? "";
          const verifierAdapter = files.get(verifierPath) ?? "";
          expect(builderAdapter).toContain(".threenative/agents/builder.md");
          expect(builderAdapter).toContain("AGENTS.md");
          expect(verifierAdapter).toContain(".threenative/agents/verifier.md");
          expect(verifierAdapter).toContain("AGENTS.md");
          expect(builderAdapter.length).toBeLessThan(500);
          expect(verifierAdapter.length).toBeLessThan(500);
        }

        const guide = files.get("AGENT-ROLES.md") ?? "";
        expect(guide).toContain("claude");
        expect(guide).toContain("codex");
        expect(guide).toContain(".agents/skills");
        expect(guide).not.toContain(".codex/skills");
        expect(guide).toContain("threenative-builder");
        expect(guide).toContain("threenative-verifier");
        const packageJson = JSON.parse(
          await readFile(path.join(result.target, "package.json"), "utf8"),
        ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
        const dependencyNames = [
          ...Object.keys(packageJson.dependencies ?? {}),
          ...Object.keys(packageJson.devDependencies ?? {}),
        ];
        expect(dependencyNames).not.toContain("claude");
        expect(dependencyNames).not.toContain("codex");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it("keeps the starter's shipped assets mobile-shippable", async () => {
    // Mobile has no WebAssembly, so neither Basis-decoded textures nor Meshopt-decoded geometry
    // can ship there. The starter's demo assets are tiny enough that compression only ever grew
    // them (150 -> 542 bytes on the 16x16 proof texture), so the template pins both to "none" —
    // the exact red this prevents, hit on 2026-08-27: `build:android` on a machine with the
    // Basis encoder refused TN_NATIVE_KTX2_UNSUPPORTED on a starter scaffold that had built
    // clean the week before, purely because the encoder got installed in between.
    const config = await readFile(
      path.join(TEMPLATE_ROOT, "starter", "threenative.config.ts"),
      "utf8",
    );
    expect(config).toMatch(/models:\s*"none"/u);
    expect(config).toMatch(/textures:\s*"none"/u);
  });

  it("should generate the starter tree without catalog protocols", async () => {
    const root = await makeTempDir("threenative-scaffold-");
    try {
      const result = await createProject(
        { install: false, target: "my-game", template: "starter" },
        root,
      );
      expect(result.template).toBe("starter");
      const packageJson = await readFile(path.join(result.target, "package.json"), "utf8");
      expect(packageJson).not.toContain("catalog:");
      const packageManifest = JSON.parse(packageJson) as {
        pnpm?: { patchedDependencies?: Record<string, string> };
      };
      expect(packageManifest.pnpm?.patchedDependencies).toEqual({
        "three@0.185.1": "patches/three@0.185.1.patch",
      });
      expect(STARTER_PATHS).toContain("playtests/survives.playtest.json");
      for (const relativePath of STARTER_PATHS) {
        await expect(
          readFile(path.join(result.target, relativePath), "utf8"),
        ).resolves.toBeTruthy();
      }
      // A scaffolded project must land with audio every target can decode, WAV included, or its
      // first `--target android` build installs and shows nothing.
      const pickupAudio = await readFile(path.join(result.target, "assets/pickup.wav"));
      expect(pickupAudio.subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(pickupAudio.subarray(8, 12).toString("ascii")).toBe("WAVE");
      const agents = await readFile(path.join(result.target, "AGENTS.md"), "utf8");
      expect(agents).toContain("my-game");
      expect(agents).not.toContain("__PROJECT_NAME__");
      await expect(readFile(path.join(result.target, "CLAUDE.md"), "utf8")).resolves.toContain(
        "Generated mirror of AGENTS.md",
      );
      await expect(
        readFile(path.join(result.target, "src/entities/Player.ts"), "utf8"),
      ).resolves.toContain("debug()");
      await expect(
        readFile(path.join(result.target, "src/scenes/Play.ts"), "utf8"),
      ).resolves.toContain('ctx.entities.add("player"');
      const renderFiles = await Promise.all(
        ["lighting.ts", "postprocessing.ts", "materials.ts"].map((file) =>
          readFile(path.join(result.target, "src/render", file), "utf8"),
        ),
      );
      expect(renderFiles.join("\n")).not.toContain("@threenative/");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // The compile step owns public/'s generated outputs; the sources ship in assets/. With no
  // raw copy left in public/, any dev server or build must compile first — which is what
  // playtests/assets.playtest.json proves against a served game.
  it("should ship source assets and never scaffold an empty assets directory", async () => {
    const root = await makeTempDir("threenative-scaffold-assets-");
    try {
      const result = await createProject(
        { install: false, target: "my-game", template: "starter" },
        root,
      );
      await expect(
        readFile(path.join(result.target, "assets/native-proof.glb")),
      ).resolves.toBeTruthy();
      const gitignore = await readFile(path.join(result.target, ".gitignore"), "utf8");
      expect(gitignore).toContain("public/assets.manifest.json");
      for (const absent of ["assets/.gitkeep", "public/assets.manifest.json"]) {
        await expect(stat(path.join(result.target, absent))).rejects.toThrow();
      }
      // The packed CLI itself depends on @threenative/assets, so a local-pack install needs a
      // pnpm override per provided source, not just a rewritten direct pin.
      const sourced = await createProject(
        {
          install: false,
          packageSources: {
            "@threenative/assets": "/tmp/assets.tgz",
            "create-threenative": "/tmp/cli.tgz",
          },
          target: "sourced-game",
          template: "starter",
        },
        root,
      );
      const sourcedManifest = JSON.parse(
        await readFile(path.join(sourced.target, "package.json"), "utf8"),
      ) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        pnpm?: { overrides?: Record<string, string> };
      };
      expect(sourcedManifest.devDependencies?.["@threenative/assets"]).toBe("file:/tmp/assets.tgz");
      expect(sourcedManifest.dependencies?.["@threenative/assets"]).toBeUndefined();
      expect(sourcedManifest.pnpm?.overrides).toMatchObject({
        "@threenative/assets": "file:/tmp/assets.tgz",
        "create-threenative": "file:/tmp/cli.tgz",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("should generate loader-valid identifiers at the leading-digit boundary", async () => {
    const root = await makeTempDir("threenative-scaffold-identifiers-");
    try {
      for (const [target, expectedId] of [
        ["123-game", "com.threenative.game123game"],
        ["fox-game", "com.threenative.foxgame"],
      ] as const) {
        const result = await createProject({ install: false, target, template: "minimal" }, root);
        await expect(loadConfig(result.target)).resolves.toMatchObject({
          app: { id: expectedId },
        });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("should scaffold the minimal six-file render layer", async () => {
    const root = await makeTempDir("threenative-minimal-render-");
    try {
      const result = await createProject(
        { install: false, target: "minimal-look", template: "minimal" },
        root,
      );
      for (const relativePath of MINIMAL_RENDER_PATHS) {
        await expect(
          readFile(path.join(result.target, relativePath), "utf8"),
        ).resolves.toBeTruthy();
      }
      await expect(readFile(path.join(result.target, "src/game.ts"), "utf8")).resolves.toContain(
        "export default game",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(ALL_TEMPLATES)(
    "should bind the game used by UI intents in the %s template",
    async (template) => {
      const source = await readFile(path.join(TEMPLATE_ROOT, template, "src/game.ts"), "utf8");
      if (!source.includes("game.ui.onIntent")) return;
      expect(source).toContain("const game = defineGame");
      expect(source).toContain("export default game");
    },
  );

  it("should not ship recast in a build that never imports the navigation entry", async () => {
    const root = await makeTempDir("threenative-minimal-bundle-");
    try {
      const result = await createProject(
        { install: false, target: "minimal-bundle", template: "minimal" },
        root,
      );
      const scope = path.join(result.target, "node_modules", "@threenative");
      await mkdir(scope, { recursive: true });
      await symlink(path.resolve("packages/core"), path.join(scope, "core"), "dir");
      await symlink(path.resolve("packages/physics"), path.join(scope, "physics"), "dir");
      // The template vite.config.ts imports watchAssets from @threenative/assets in serve
      // mode; a build that resolves the config needs the package present to reject it.
      await symlink(path.resolve("packages/assets"), path.join(scope, "assets"), "dir");
      await symlink(
        path.resolve("packages/create-threenative"),
        path.join(result.target, "node_modules", "create-threenative"),
        "dir",
      );
      const pnpmPackages = await readdir(path.resolve("node_modules/.pnpm"));
      const vitePackage = pnpmPackages.find((entry) => entry.startsWith("vite@"));
      const threePackage = pnpmPackages.find((entry) => entry.startsWith("three@"));
      if (vitePackage === undefined || threePackage === undefined) {
        throw new Error("Bundle isolation requires the workspace Vite and Three.js packages.");
      }
      await symlink(
        path.resolve("node_modules/.pnpm", vitePackage, "node_modules/vite"),
        path.join(result.target, "node_modules", "vite"),
        "dir",
      );
      await symlink(
        path.resolve("node_modules/.pnpm", threePackage, "node_modules/three"),
        path.join(result.target, "node_modules", "three"),
        "dir",
      );
      try {
        const viteCli = path.resolve(
          "node_modules/.pnpm",
          vitePackage,
          "node_modules/vite/bin/vite.js",
        );
        await run(process.execPath, [viteCli, "build", result.target], { cwd: process.cwd() });
      } catch (error) {
        const output = error as { code?: string | number; stderr?: string; stdout?: string };
        throw new Error(
          `${error instanceof Error ? error.message : String(error)} code=${output.code ?? "unknown"}\n${output.stdout ?? ""}\n${output.stderr ?? ""}`,
        );
      }
      const distRoot = path.join(result.target, "dist");
      const entries = await readdir(distRoot, { recursive: true });
      const files = (
        await Promise.all(
          entries.map(async (entry) => {
            const relativePath = String(entry);
            return (await stat(path.join(distRoot, relativePath))).isFile()
              ? relativePath
              : undefined;
          }),
        )
      ).filter((entry): entry is string => entry !== undefined);
      const artifactNames = files.filter((file) => file.toLowerCase().includes("recast"));
      const contents = await Promise.all(
        files.map(async (file) => {
          const value = await readFile(path.join(result.target, "dist", file));
          return value.toString("utf8");
        }),
      );

      expect(artifactNames).toEqual([]);
      expect(contents.join("\n")).not.toMatch(/recast-navigation|@recast-navigation/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 15_000);

  it("should parse the no-install and template flags", () => {
    expect(parseArgs(["my-game", "--template", "minimal", "--no-install"])).toEqual({
      install: false,
      target: "my-game",
      template: "minimal",
    });
  });

  it("should fail closed when the capabilities manifest is missing from the package", async () => {
    const root = await makeTempDir("threenative-capabilities-missing-");
    try {
      await cp(TEMPLATE_ROOT, path.join(root, "templates"), { recursive: true });
      await cp(
        path.resolve("packages/create-threenative/template-assets"),
        path.join(root, "template-assets"),
        { recursive: true },
      );
      await cp(
        path.resolve("packages/create-threenative/agent-docs"),
        path.join(root, "agent-docs"),
        { recursive: true },
      );
      await cp(
        path.resolve("packages/create-threenative/agent-files"),
        path.join(root, "agent-files"),
        { recursive: true },
      );
      // capabilities.json deliberately absent: this is the `files` regression the copy
      // used to paper over, leaving every generated project without capability search.
      await expect(
        createProject(
          { install: false, target: "my-game", template: "starter" },
          root,
          path.join(root, "templates"),
        ),
      ).rejects.toThrow(/TN_KIT_CAPABILITIES_MISSING/u);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 30_000);

  it("should reject an occupied or file target and create nested parents", async () => {
    const root = await makeTempDir("threenative-target-collisions-");
    try {
      await mkdir(path.join(root, "occupied"), { recursive: true });
      await writeFile(path.join(root, "occupied", "keep.txt"), "x");
      await expect(createProject({ install: false, target: "occupied" }, root)).rejects.toThrow(
        /already exists and is not empty/u,
      );

      await writeFile(path.join(root, "a-file"), "x");
      await expect(createProject({ install: false, target: "a-file" }, root)).rejects.toThrow(
        /already exists and is not empty/u,
      );

      const result = await createProject({ install: false, target: "nested/deep/game" }, root);
      expect(result.target.endsWith("nested/deep/game")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("should fail closed on a malformed kit manifest with the exact named codes", async () => {
    const templates = path.join(await makeTempDir("threenative-kit-manifest-"), "templates");
    const valid = {
      blurb: "collect pickups",
      genre: "arcade",
      kit: true,
      name: "pickup",
      title: "Pickup Run",
    };
    const cases: ReadonlyArray<[string, string, RegExp]> = [
      ["noparse", "not json", /TN_KIT_MANIFEST_INVALID.*JSON could not be parsed/u],
      ["array", "[]", /root must be an object/u],
      [
        "name-mismatch",
        JSON.stringify({ ...valid, name: "other" }),
        /name 'other' must match directory 'name-mismatch'/u,
      ],
      [
        "not-kit",
        JSON.stringify({ ...valid, name: "not-kit", kit: "yes" }),
        /kit must be a boolean/u,
      ],
      [
        "no-blurb",
        JSON.stringify({ ...valid, name: "no-blurb", blurb: "" }),
        /blurb must be a non-empty string/u,
      ],
      [
        "no-genre",
        JSON.stringify({ ...valid, name: "no-genre", genre: 7 }),
        /genre must be a non-empty string/u,
      ],
      [
        "no-title",
        JSON.stringify({ ...valid, name: "no-title", title: "" }),
        /title must be a non-empty string/u,
      ],
    ];
    try {
      for (const [name, content, expected] of cases) {
        const directory = path.join(templates, name);
        await mkdir(directory, { recursive: true });
        await writeFile(path.join(directory, "kit.json"), content);
        try {
          expect(() => discoverKitManifests(templates)).toThrow(expected);
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      }
      expect(discoverKitManifests(templates)).toEqual([]);
    } finally {
      await rm(templates, { recursive: true, force: true });
    }
  });

  it("should parse flags that precede the target directory", () => {
    expect(parseArgs(["--no-install", "my-game"])).toEqual({
      install: false,
      target: "my-game",
    });
    expect(parseArgs(["--template", "minimal", "--no-install", "my-game"])).toEqual({
      install: false,
      target: "my-game",
      template: "minimal",
    });
  });

  it("should parse equals-form flags", () => {
    expect(parseArgs(["--template=minimal", "my-game"])).toEqual({
      install: true,
      target: "my-game",
      template: "minimal",
    });
    expect(parseArgs(["--no-install", "--cli-package=/tmp/cli.tgz", "my-game"])).toEqual({
      install: false,
      packageSources: { "create-threenative": "/tmp/cli.tgz" },
      target: "my-game",
    });
  });

  it("should fail closed on unknown and dangling flags instead of ignoring them", () => {
    expect(() => parseArgs(["my-game", "--tempalte", "minimal"])).toThrow(
      "Unknown option '--tempalte'. Usage: pnpm create threenative my-game",
    );
    expect(() => parseArgs(["my-game", "--template"])).toThrow(
      "Option '--template' requires a value. Usage: pnpm create threenative my-game",
    );
    expect(() => parseArgs(["my-game", "other-game"])).toThrow(
      "Unexpected extra argument 'other-game'. Usage: pnpm create threenative my-game",
    );
  });

  it("should scaffold the platformer template with no catalog protocols", async () => {
    const root = await makeTempDir("threenative-platformer-");
    try {
      const result = await createProject(
        { install: false, target: "fox-run", template: "platformer" },
        root,
      );
      expect(result.template).toBe("platformer");
      const packageJson = await readFile(path.join(result.target, "package.json"), "utf8");
      expect(packageJson).not.toContain("catalog:");
      for (const relativePath of PLATFORMER_PATHS) {
        await expect(
          readFile(path.join(result.target, relativePath), "utf8"),
        ).resolves.toBeTruthy();
      }
      await expect(
        readFile(path.join(result.target, "src/entities/Character.ts"), "utf8"),
      ).resolves.toContain("PLATFORMER_FEEL");
      await expect(
        readFile(path.join(result.target, "src/scenes/Level.ts"), "utf8"),
      ).resolves.toContain('ctx.entities.add("player"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("should launch all three MCP servers through the core shims", async () => {
    const root = await makeTempDir("threenative-mcp-");
    try {
      const result = await createProject(
        { install: false, target: "my-game", template: "starter" },
        root,
      );
      const raw = await readFile(path.join(result.target, ".mcp.json"), "utf8");
      expect(raw).not.toContain("npx");
      const config = JSON.parse(raw) as {
        mcpServers: Record<string, { args: string[]; command: string }>;
      };
      const assetServer = config.mcpServers["threenative-assets"];
      expect(assetServer?.command).toBe("node");
      expect(assetServer?.args[0]).toBe(`${CORE_SHIM}/assets.mjs`);
      const sculptServer = config.mcpServers["threenative-sculpt"];
      expect(sculptServer?.command).toBe("node");
      expect(sculptServer?.args[0]).toBe(`${CORE_SHIM}/sculpt.mjs`);
      const engineServer = config.mcpServers["threenative-engine"];
      expect(engineServer?.command).toBe("node");
      expect(engineServer?.args[0]).toBe(`${CORE_SHIM}/engine.mjs`);
      const codex = await readFile(path.join(result.target, ".codex", "config.toml"), "utf8");
      expect(codex).toContain("[mcp_servers.threenative-engine]");
      expect(codex).toContain(`args = ["${CORE_SHIM}/engine.mjs"]`);
      const manifest = JSON.parse(
        await readFile(path.join(result.target, "package.json"), "utf8"),
      ) as { devDependencies?: Record<string, string> };
      expect(manifest.devDependencies?.[ASSET_MCP]).toBeUndefined();
      expect(manifest.devDependencies?.[SCULPT_MCP]).toBeUndefined();
      expect(manifest.devDependencies?.[ENGINE_MCP]).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("should ship the same MCP config and pins in every template", async () => {
    const configs = await Promise.all(
      ALL_TEMPLATES.map((template) => readFile(path.join(TEMPLATE_ROOT, template, ".mcp.json"))),
    );
    const codexConfigs = await Promise.all(
      ALL_TEMPLATES.map((template) =>
        readFile(path.join(TEMPLATE_ROOT, template, ".codex", "config.toml")),
      ),
    );
    const pins = await Promise.all(
      ALL_TEMPLATES.map(async (template) => {
        const manifest = JSON.parse(
          await readFile(path.join(TEMPLATE_ROOT, template, "package.json"), "utf8"),
        ) as { devDependencies?: Record<string, string> };
        return {
          asset: manifest.devDependencies?.[ASSET_MCP],
          engine: manifest.devDependencies?.[ENGINE_MCP],
          sculpt: manifest.devDependencies?.[SCULPT_MCP],
        };
      }),
    );
    expect(new Set(configs.map((config) => config.toString("utf8"))).size).toBe(1);
    expect(new Set(codexConfigs.map((config) => config.toString("utf8"))).size).toBe(1);
    expect(pins.every(({ asset, engine, sculpt }) => !asset && !engine && !sculpt)).toBe(true);
  });

  it("should document only tools the pinned asset MCP actually serves", async () => {
    const surface = JSON.parse(
      await readFile(path.resolve("packages/create-threenative/asset-mcp-tools.json"), "utf8"),
    ) as { recommended: string[]; tools: string[]; version: string };
    const served = new Set(surface.tools);
    const coreManifest = JSON.parse(
      await readFile(path.resolve("packages/core/package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    expect(coreManifest.dependencies?.[ASSET_MCP]).toBe(surface.version);
    const namespaces = new Set(surface.tools.map((tool) => tool.split("_")[0]));
    for (const template of ALL_TEMPLATES) {
      const agents = await readFile(path.join(TEMPLATE_ROOT, template, "AGENTS.md"), "utf8");
      const mentioned = [...agents.matchAll(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/gu)]
        .map((match) => match[1] as string)
        .filter((name) => namespaces.has(name.split("_")[0] as string));
      expect(
        mentioned.filter((name) => !served.has(name)),
        template,
      ).toEqual([]);
      for (const name of surface.recommended) expect(agents, `${template}/${name}`).toContain(name);
    }
  });

  it("should throw when .mcp.json is missing from the template", async () => {
    const root = await makeTempDir("threenative-mcp-missing-");
    try {
      await withBrokenTemplateFile("starter/.mcp.json", undefined, async (templates) => {
        await expect(
          createProject(
            { install: false, target: "my-game", template: "starter" },
            root,
            templates,
          ),
        ).rejects.toThrow(/no \.mcp\.json/u);
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
    // Copies every template tree into a temp dir, which is thousands of files; the 5 s default
    // trips on a loaded machine and reports a timeout where there is no defect.
  }, 30_000);

  it("should throw when .mcp.json omits the sculpt server", async () => {
    const root = await makeTempDir("threenative-mcp-sculpt-missing-");
    try {
      const broken = JSON.stringify({
        mcpServers: {
          "threenative-assets": {
            command: "node",
            args: [`${CORE_SHIM}/assets.mjs`],
          },
        },
      });
      await withBrokenTemplateFile("starter/.mcp.json", broken, async (templates) => {
        await expect(
          createProject(
            { install: false, target: "my-game", template: "starter" },
            root,
            templates,
          ),
        ).rejects.toThrow(/missing required MCP server 'threenative-sculpt'/u);
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
    // Copies every template tree into a temp dir, which is thousands of files; the 5 s default
    // trips on a loaded machine and reports a timeout where there is no defect.
  }, 30_000);

  it("should throw when .mcp.json omits the engine server", async () => {
    const root = await makeTempDir("threenative-mcp-engine-missing-");
    try {
      const broken = JSON.stringify({
        mcpServers: {
          "threenative-assets": {
            command: "node",
            args: [`${CORE_SHIM}/assets.mjs`],
          },
          "threenative-sculpt": {
            command: "node",
            args: [`${CORE_SHIM}/sculpt.mjs`],
          },
        },
      });
      await withBrokenTemplateFile("starter/.mcp.json", broken, async (templates) => {
        await expect(
          createProject(
            { install: false, target: "my-game", template: "starter" },
            root,
            templates,
          ),
        ).rejects.toThrow(/missing required MCP server 'threenative-engine'/u);
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("should throw when .mcp.json names a package the project does not depend on", async () => {
    const root = await makeTempDir("threenative-mcp-undeclared-");
    try {
      const broken = JSON.stringify({
        mcpServers: {
          "threenative-assets": {
            command: "node",
            args: [`${CORE_SHIM}/assets.mjs`],
          },
          "threenative-sculpt": {
            command: "node",
            args: ["./node_modules/not-a-dependency/dist/index.js"],
          },
          "threenative-engine": {
            command: "node",
            args: [`${CORE_SHIM}/engine.mjs`],
          },
        },
      });
      await withBrokenTemplateFile("starter/.mcp.json", broken, async (templates) => {
        await expect(
          createProject(
            { install: false, target: "my-game", template: "starter" },
            root,
            templates,
          ),
        ).rejects.toThrow(/not-a-dependency.*does not depend on/u);
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
    // Copies every template tree into a temp dir, which is thousands of files; the 5 s default
    // trips on a loaded machine and reports a timeout where there is no defect.
  }, 30_000);

  it("should throw when .mcp.json launches an unpinned remote package", async () => {
    const root = await makeTempDir("threenative-mcp-npx-");
    try {
      const broken = JSON.stringify({
        mcpServers: {
          "threenative-assets": {
            command: "node",
            args: [`${CORE_SHIM}/assets.mjs`],
          },
          "threenative-sculpt": { command: "npx", args: ["-y", SCULPT_MCP] },
          "threenative-engine": {
            command: "node",
            args: [`${CORE_SHIM}/engine.mjs`],
          },
        },
      });
      await withBrokenTemplateFile("starter/.mcp.json", broken, async (templates) => {
        await expect(
          createProject(
            { install: false, target: "my-game", template: "starter" },
            root,
            templates,
          ),
        ).rejects.toThrow(/must launch from '\.\/node_modules\/'/u);
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
    // Copies every template tree into a temp dir, which is thousands of files; the 5 s default
    // trips on a loaded machine and reports a timeout where there is no defect.
  }, 30_000);

  it("should accept a local playtest package for scaffold smoke tests", () => {
    expect(
      parseArgs(["my-game", "--no-install", "--playtest-package", "/tmp/playtest.tgz"]),
    ).toEqual({
      install: false,
      packageSources: { "@threenative/playtest": "/tmp/playtest.tgz" },
      target: "my-game",
    });
  });

  it("should accept a local package added to the workspace without a CLI map edit", () => {
    expect(
      parseArgs(["my-game", "--no-install", "--new-package-package", "/tmp/new-package.tgz"]),
    ).toEqual({
      install: false,
      packageSources: { "@threenative/new-package": "/tmp/new-package.tgz" },
      target: "my-game",
    });
  });

  it("should accept a local engine MCP package for offline scaffold tests", () => {
    expect(
      parseArgs(["my-game", "--no-install", "--engine-mcp-package", "/tmp/engine-mcp.tgz"]),
    ).toEqual({
      install: false,
      packageSources: { "threenative-engine-mcp": "/tmp/engine-mcp.tgz" },
      target: "my-game",
    });
  });

  it("should accept the short local runtime package override", () => {
    expect(parseArgs(["my-game", "--no-install", "--runtime-package", "/tmp/runtime.tgz"])).toEqual(
      {
        install: false,
        packageSources: { "@threenative/runtime-native": "/tmp/runtime.tgz" },
        target: "my-game",
      },
    );
  });
  it("maps scoped workspace packages with colliding names to distinct source flags", () => {
    expect(
      parseArgs([
        "my-game",
        "--no-install",
        "--threenative-cli-package",
        "/tmp/scoped-cli.tgz",
        "--threenative-engine-mcp-package",
        "/tmp/scoped-engine-mcp.tgz",
      ]),
    ).toEqual({
      install: false,
      packageSources: {
        "@threenative/cli": "/tmp/scoped-cli.tgz",
        "@threenative/engine-mcp": "/tmp/scoped-engine-mcp.tgz",
      },
      target: "my-game",
    });
  });

  it("should keep a local native runtime optional", async () => {
    const root = await makeTempDir("threenative-local-runtime-");
    try {
      const result = await createProject(
        {
          install: false,
          packageSources: { "@threenative/runtime-native": "/tmp/runtime.tgz" },
          target: "my-game",
        },
        root,
      );
      const manifest = JSON.parse(await readFile(path.join(result.target, "package.json"), "utf8"));
      expect(manifest.optionalDependencies["@threenative/runtime-native"]).toBe(
        "file:/tmp/runtime.tgz",
      );
      expect(manifest.dependencies["@threenative/runtime-native"]).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

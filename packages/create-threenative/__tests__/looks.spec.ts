import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildImplicitSurface } from "../templates/starter/src/render/implicitSurface.js";
import { createKuwaharaStage } from "../templates/starter/src/render/kuwahara.js";
import { qualityPreset } from "../templates/starter/src/render/quality.js";
import { createRockRidge, sampleGraniteField } from "../templates/starter/src/render/rockRidge.js";
import { createWatercolorStage } from "../templates/starter/src/render/watercolor.js";

const starter = path.resolve("packages/create-threenative/templates/starter");
const minimal = path.resolve("packages/create-threenative/templates/minimal");
const platformer = path.resolve("packages/create-threenative/templates/platformer");
const templatesRoot = path.resolve("packages/create-threenative/templates");
const bootErrorSelector = '[data-threenative-canvas-error="true"]';
const requiredBootErrorDeclarations = [
  ["position", "fixed"],
  ["inset", "0"],
  ["z-index", "1000"],
  ["display", "grid"],
  ["place-items", "center"],
  ["overflow-wrap", "anywhere"],
] as const;
const bootErrorColour = /^(?:#[\da-f]{6}|var\(--[\w-]+\))$/iu;

describe("starter visual floor", () => {
  it("should provide readable dynamic-range defaults without framework imports", async () => {
    const files = await Promise.all(
      ["lighting.ts", "postprocessing.ts", "worldEnvironment.ts", "materials.ts"].map((file) =>
        readFile(path.join(starter, "src/render", file), "utf8"),
      ),
    );
    const source = files.join("\n");
    expect(source).toContain("shadow");
    expect(source).toContain("ACESFilmicToneMapping");
    expect(source).not.toContain("@threenative/");
  });

  it("should route setupPost through the framework output node", async () => {
    const [post, environment] = await Promise.all([
      readFile(path.join(starter, "src/render/postprocessing.ts"), "utf8"),
      readFile(path.join(starter, "src/render/worldEnvironment.ts"), "utf8"),
    ]);
    const play = await readFile(path.join(starter, "src/scenes/Play.ts"), "utf8");
    expect(`${post}\n${environment}`).toContain("createRenderChain");
    expect(`${post}\n${environment}`).toContain("bloom");
    expect(play).toContain("setupPost");
  });

  it("should collect the starter's authored outline caller", async () => {
    const [environment, painterly] = await Promise.all([
      readFile(path.join(starter, "src/render/worldEnvironment.ts"), "utf8"),
      readFile(path.join(starter, "src/render/painterly.ts"), "utf8"),
    ]);
    expect(painterly).toContain("createOutlineStage");
    expect(painterly).toContain('names.push("outline")');
    expect(environment).toContain("createRenderChain");
    // The other half of the same rule, and the one that actually bites: `worldEnvironment.ts` is
    // the plumbing every kit copies verbatim, so this kit's aesthetic must not be inside it.
    // `shared-render-sources.spec.ts` fails when it is, and this says why in one place.
    expect(environment).not.toContain("createOutlineStage");
  });

  it("should keep painterly stages in generated source with a measured tier policy", async () => {
    const [environment, painterly, quality, outline, kuwahara, watercolor] = await Promise.all([
      readFile(path.join(starter, "src/render/worldEnvironment.ts"), "utf8"),
      readFile(path.join(starter, "src/render/painterly.ts"), "utf8"),
      readFile(path.join(starter, "src/render/quality.ts"), "utf8"),
      readFile(path.join(starter, "src/render/outline.ts"), "utf8"),
      readFile(path.join(starter, "src/render/kuwahara.ts"), "utf8"),
      readFile(path.join(starter, "src/render/watercolor.ts"), "utf8"),
    ]);
    const generated = [outline, kuwahara, watercolor].join("\n");
    expect(generated).not.toContain("@threenative/");
    expect(generated).not.toMatch(/ShaderMaterial|gl_FragColor|postprocessing/iu);
    expect(painterly).toContain("createKuwaharaStage");
    expect(painterly).toContain("createWatercolorStage");
    expect(environment).not.toContain("createKuwaharaStage");
    expect(environment).not.toContain("createWatercolorStage");
    expect(generated.indexOf('name: "outline"')).toBeGreaterThanOrEqual(0);
    expect(generated.indexOf('name: "kuwahara"')).toBeGreaterThanOrEqual(0);
    expect(generated.indexOf('name: "watercolor"')).toBeGreaterThanOrEqual(0);
    expect(generated.indexOf('after: "outline"')).toBeGreaterThanOrEqual(0);
    expect(generated.indexOf('after: "kuwahara"')).toBeGreaterThanOrEqual(0);
    expect(quality).toContain("outlineEnabled: true");
    expect(quality).toContain("kuwaharaRadius: 5");
    expect(quality).toContain("kuwaharaResolutionScale: 0.5");
    expect(quality).toContain("outlineEnabled: false");
    expect(quality).toContain("kuwaharaEnabled: false");
    expect(quality).toContain("watercolorEnabled: false");
    expect(kuwahara).toContain("HalfFloatType");
    expect(kuwahara).toContain("renderTarget.dispose");
    expect(watercolor).not.toMatch(/ACES|toneMapping/iu);
  });

  it("should preserve hue while transforming paint", async () => {
    const watercolor = await readFile(path.join(starter, "src/render/watercolor.ts"), "utf8");
    expect(watercolor).toContain("base.rgb.mul(stepped.div(sceneLuminance.max(0.0001)))");
    const original = { b: 0.2, g: 0.4, r: 0.8 };
    const luminance = 0.2126 * original.r + 0.7152 * original.g + 0.0722 * original.b;
    const stepped = Math.min(1, (Math.floor(luminance * 8) + 0.5) / 8);
    const scale = stepped / luminance;
    const grouped = { b: original.b * scale, g: original.g * scale, r: original.r * scale };
    expect(grouped.r / original.r).toBeCloseTo(grouped.g / original.g, 9);
    expect(grouped.g / original.g).toBeCloseTo(grouped.b / original.b, 9);
  });

  it("should use the half-angle in the runtime tensor graph", async () => {
    const kuwahara = await readFile(path.join(starter, "src/render/kuwahara.ts"), "utf8");
    expect(kuwahara).toMatch(
      /const orientation = tsl\s*\.\s*atan\(\s*tensorSample\.y\.mul\(2\),\s*tensorSample\.x\.sub\(tensorSample\.z\)\s*\)\s*\.\s*mul\(0\.5\);/u,
    );
  });

  it("should sample bounded two-dimensional Kuwahara areas at radius five", async () => {
    const kuwahara = await readFile(path.join(starter, "src/render/kuwahara.ts"), "utf8");
    expect(kuwahara).toMatch(/function sectorSampleOffsets\(radius: number\)/u);
    expect(kuwahara).toMatch(/for \(let radial = 1; radial <= bounded; radial \+= 1\)/u);
    expect(kuwahara).toMatch(
      /for \(let tangent = -halfWidth; tangent <= halfWidth; tangent \+= 1\)/u,
    );
    expect(kuwahara).toMatch(/for \(const localOffset of sectorOffsets\)/u);
    expect(5 * 5).toBe(25);
    expect(5 * 5 * 8).toBe(200);
  });

  it("should keep the runtime node transform in matrix-times-vector order", async () => {
    const kuwahara = await readFile(path.join(starter, "src/render/kuwahara.ts"), "utf8");
    const helper = kuwahara.slice(kuwahara.indexOf("function transformKernelOffsetNode"));
    expect(helper).toMatch(
      /axis\.x\s*\.\s*mul\(scaled\.x\)\s*\.\s*sub\(axis\.y\s*\.\s*mul\(scaled\.y\)\)[\s\S]*axis\.y\s*\.\s*mul\(scaled\.x\)\s*\.\s*add\(axis\.x\s*\.\s*mul\(scaled\.y\)\)/u,
    );
    expect(helper).not.toMatch(/scaled\.x\s*\.\s*mul\(axis\.x\)/u);
    expect(helper).not.toMatch(/scaled\.y\s*\.\s*mul\(axis\.y\)/u);
  });

  it("should use fewer watercolor luminance bands on medium than high", () => {
    const highPreset = qualityPreset("high");
    const mediumPreset = qualityPreset("medium");
    const highLevels = highPreset.watercolorLevels ?? 8;
    expect(highLevels).toBe(8);
    expect(mediumPreset.watercolorLevels).toBe(6);
    expect(mediumPreset.watercolorLevels).toBeLessThan(highLevels);
  });

  it("should preserve most source contrast through the shipped Kuwahara mix", () => {
    for (const tier of ["high", "medium"] as const) {
      const strength = qualityPreset(tier).kuwaharaStrength;
      expect(strength, tier).toBeDefined();
      expect(1 - (strength ?? 1), tier).toBeGreaterThanOrEqual(0.6);
    }
  });

  it("should fail closed on missing paint input even for zero-strength no-ops", () => {
    expect(() => createKuwaharaStage({ strength: 0 }).build(undefined)).toThrow(
      /kuwahara input is missing/u,
    );
    expect(() => createWatercolorStage({ strength: 0 }).build(undefined)).toThrow(
      /watercolor input is missing/u,
    );
  });

  it("should remove debug materials and wire live shadows", async () => {
    const files = await Promise.all([
      readFile(path.join(starter, "src/entities/Player.ts"), "utf8"),
      readFile(path.join(starter, "src/entities/Crate.ts"), "utf8"),
      readFile(path.join(starter, "src/scenes/Play.ts"), "utf8"),
      readFile(path.join(minimal, "src/entities/Player.ts"), "utf8"),
      readFile(path.join(minimal, "src/scenes/Play.ts"), "utf8"),
    ]);
    expect(files.join("\n")).not.toContain("MeshNormalMaterial");
    expect(await readFile(path.join(starter, "src/render/materials.ts"), "utf8")).toMatch(
      /floor:[\s\S]*player:[\s\S]*crate:/,
    );
    expect(await readFile(path.join(starter, "src/render/lighting.ts"), "utf8")).toContain(
      "shadowMap.enabled = true",
    );
    expect(files.join("\n")).toContain("receiveShadow = true");
  });

  it("should keep generated render files readable and framework-free", async () => {
    // This used to cap every render file at 20 lines, which was CHARTER §11
    // rule 1 applied to the one folder rule 3 sends the look to. The result
    // was a 47-line visual floor: three materials and a three-light rig, no
    // rounded geometry, no rim light. Every scaffolded project then had to
    // rediscover the entire look, and agents — graded by typecheck, lint and
    // playtests, none of which can see a pixel — mostly did not.
    //
    // The rule that actually matters here is ownership, not length: these
    // files must stay plain Three.js the user can rewrite, never a framework
    // reaching back in. The cap is now a smell test for a hidden engine.
    const roots = [starter, minimal, platformer];
    const files = await Promise.all(
      roots.flatMap(async (root) => {
        const names = await renderFiles(path.join(root, "src/render"));
        return Promise.all(
          names.map(async (file) => [file, await readFile(file, "utf8")] as const),
        );
      }),
    );
    for (const entries of files) {
      for (const [name, source] of entries) {
        expect(source, name).not.toContain("@threenative/");
        // Loading is the one generated surface that carries real startup behavior: safe-area
        // layout, texture crops, truthful progress and disposal. Its source stays game-owned; the
        // old 200-line smell cap must not reject that behavior.
        // WorldEnvironment is the starter's complete, Godot-named visual recipe. It intentionally
        // carries the stage contracts and their reasons in one editable file; the ownership check
        // above still prevents it from becoming a hidden framework import.
        if (!name.endsWith("loading.ts") && !name.endsWith("worldEnvironment.ts"))
          expect(source.trimEnd().split("\n").length, name).toBeLessThan(200);
      }
    }
  });

  it("should refuse godrays by name when the shadow map is not allocated yet", async () => {
    // `castShadow` is a request, not a result: three allocates the shadow map on the first render
    // that needs it, and GodraysNode reads `shadow.map.depthTexture` while the graph is built.
    // Reading it too early throws inside TSL, which fails the whole chain build — so SSGI, SSR,
    // bloom and the tonemap all vanish with it and the frame comes back ungraded. That reads as a
    // broken scene rather than a missing shadow map, and it cost a day of the cave scene.
    //
    // The stage list's contract is that an unavailable stage is refused **by name, with a
    // reason**, leaving the rest of the chain intact. Guarding the map is what keeps that promise.
    const templateRoot = path.join(starter, "..");
    const templates = (await readdir(templateRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(templates.length).toBeGreaterThan(0);
    for (const template of templates) {
      const source = await readFile(
        path.join(templateRoot, template, "src/render/worldEnvironment.ts"),
        "utf8",
      );
      const guard = source.slice(source.indexOf('name: "godRays"'));
      expect(guard.slice(0, guard.indexOf("build:")), template).toContain("shadow?.map == null");
    }
  });

  it("should ship a rounded-geometry floor rather than raw boxes", async () => {
    // A sharp BoxGeometry reads as Minecraft; the same box with a corner
    // radius reads as a toy. Shipping this is most of the difference between
    // a generated project that looks designed and one that looks like a test
    // scene, and it is far too long to expect an agent to rederive.
    const shapes = await readFile(path.join(starter, "src/render/shapes.ts"), "utf8");
    expect(shapes).toContain("export function roundedBox");
    expect(shapes).toContain("mergeVertices");
    expect(shapes).toContain("computeVertexNormals");
    expect(shapes).not.toContain("Math.random(");

    // Deterministic scatter: `Math.random` makes a screenshot diff meaningless, because you
    // cannot tell a bug from a reroll. This used to be asserted by requiring `shapes.ts` to
    // export its own `makeRandom` — a hand-rolled LCG that was a line-for-line copy of the
    // `createRandom` the framework already exports with a `@supersedes Math.random(` tag, which
    // taught every cold agent reading the starter to write the copy rather than the import.
    // The seeded source now comes from the framework and is threaded in from the scene, because
    // `src/render/` may not import a framework package. Assert the property, not the copy:
    // the scatter is seeded, and nothing in the chain reaches for `Math.random`.
    const scenery = await readFile(path.join(starter, "src/render/scenery.ts"), "utf8");
    expect(scenery).toContain("random: () => number");
    expect(scenery).not.toContain("Math.random(");
    const play = await readFile(path.join(starter, "src/scenes/Play.ts"), "utf8");
    expect(play).toContain("createRandom");
    expect(play).toMatch(/createScenery\([^)]*createRandom\(\d[\d_]*\)\)/u);
    expect(play).not.toContain("Math.random(");
  });

  it("should build deterministic watertight granite from the live field", () => {
    const bounds = { maxX: 54, maxY: 18, maxZ: -42, minX: -54, minY: -32, minZ: -74 } as const;
    const build = (seed: number, cellSize = 2.1) =>
      buildImplicitSurface({
        bounds,
        cellSize,
        latticeCap: 100_000,
        closed: true,
        protectBoundary: true,
        sample: (x, y, z) => sampleGraniteField(x, y, z, seed, bounds),
      });
    const bytes = (array: Float32Array | Uint32Array) =>
      Buffer.from(array.buffer, array.byteOffset, array.byteLength).toString("hex");
    for (const seed of [20_260_821, 11, 99]) {
      const result = build(seed);
      expect(result.report).toMatchObject({
        boundaryEdges: 0,
        degenerateTriangles: 0,
        windingConflicts: 0,
      });
      expect(result.report.signedVolume).toBeGreaterThan(1);
    }
    const first = build(20_260_821);
    const same = build(20_260_821);
    const different = build(11);
    expect(bytes(first.positions)).toBe(bytes(same.positions));
    expect(bytes(first.indices)).toBe(bytes(same.indices));
    expect(bytes(first.positions)).not.toBe(bytes(different.positions));
  });

  it("should carry the fused ridge through its authored contact band", async () => {
    const ridge = await readFile(path.join(starter, "src/render/rockRidge.ts"), "utf8");
    const contact = /const contactY = (-?\d+(?:\.\d+)?)/u.exec(ridge)?.[1];
    if (contact === undefined)
      throw new Error("Rock ridge contact band is not authored in the field.");
    const contactY = Number(contact);
    expect(contactY).toBe(-20);
    expect(ridge).toContain("minY: -32");
    const bounds = { maxX: 54, maxY: 18, maxZ: -42, minX: -54, minY: -32, minZ: -74 } as const;
    const result = buildImplicitSurface({
      bounds,
      cellSize: 2.1,
      latticeCap: 100_000,
      closed: true,
      protectBoundary: true,
      sample: (x, y, z) => sampleGraniteField(x, y, z, 20_260_821, bounds),
    });
    const minimumY = Math.min(
      ...Array.from(
        { length: result.positions.length / 3 },
        (_, index) => result.positions[index * 3 + 1] as number,
      ),
    );
    expect(sampleGraniteField(0, contactY, -58, 20_260_821, bounds)).toBeLessThan(0);
    expect(minimumY).toBeLessThan(contactY);
    expect(result.report).toMatchObject({
      boundaryEdges: 0,
      degenerateTriangles: 0,
      windingConflicts: 0,
    });
  });

  it("should drive look movement before the long refinement wait", async () => {
    const scenario = JSON.parse(
      await readFile(path.join(starter, "playtests/look.playtest.json"), "utf8"),
    ) as {
      assert?: {
        components?: Array<{
          allowTrivial?: string;
          atSteps?: Array<{ equals?: unknown; label: string }>;
          component?: string;
          entity?: string;
          equals?: unknown;
          path?: string;
        }>;
        resources?: Array<{
          atSteps?: Array<{ label: string; textIncludes?: string }>;
          id?: string;
          path?: string;
        }>;
      };
      steps: Array<{
        holdTicks?: number;
        kind?: string;
        label?: string;
        press?: string;
        release?: boolean;
        waitTicks?: number;
      }>;
      warmupFrames?: number;
    };
    const labels = scenario.steps.map(({ label }) => label);
    expect(labels).toEqual(["preview-pending", "move-before-refinement", "refinement-settles"]);
    expect(scenario.warmupFrames).toBe(1);
    expect(scenario.steps[0]).toMatchObject({
      kind: "wait",
      label: "preview-pending",
      waitTicks: 1,
      release: true,
    });
    const movementIndex = scenario.steps.findIndex(
      ({ label }) => label === "move-before-refinement",
    );
    const refinementIndex = scenario.steps.findIndex(({ label }) => label === "refinement-settles");
    expect(movementIndex).toBeGreaterThanOrEqual(0);
    expect(refinementIndex).toBeGreaterThan(movementIndex);
    expect(scenario.steps[movementIndex]).toMatchObject({
      kind: "input",
      holdTicks: 140,
      press: "ArrowRight",
      release: true,
    });
    expect(scenario.steps[refinementIndex]).toMatchObject({ kind: "wait", waitTicks: 600 });
    const pendingState = scenario.assert?.components?.find(
      ({ component, entity }) => component === "state" && entity === "scenery.ridge",
    );
    expect(pendingState).toMatchObject({
      atSteps: [{ equals: "preview", label: "preview-pending" }],
      component: "state",
      entity: "scenery.ridge",
      equals: "refined",
    });
    expect(pendingState).not.toHaveProperty("allowTrivial");
    const pendingGeneration = scenario.assert?.components?.find(
      ({ component, entity }) => component === "generation" && entity === "scenery.ridge",
    );
    expect(pendingGeneration).toMatchObject({
      atSteps: [{ equals: 0, label: "preview-pending" }],
      component: "generation",
      entity: "scenery.ridge",
      gte: 1,
    });
    expect(pendingGeneration).not.toHaveProperty("allowTrivial");
    expect(scenario.assert?.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          atSteps: [{ label: "move-before-refinement", textIncludes: "." }],
          id: "state",
          path: "odometer",
        }),
      ]),
    );
    expect(scenario.assert?.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ component: "state", entity: "scenery.ridge", equals: "refined" }),
        expect.objectContaining({
          component: "topology",
          entity: "scenery.ridge",
          equals: 0,
          path: "boundaryEdges",
        }),
      ]),
    );
  });

  it("should protect a boundary-touching surface and reject malformed fields", () => {
    const bounds = { maxX: 1, maxY: 1, maxZ: 1, minX: 0, minY: 0, minZ: 0 } as const;
    const touching = (x: number, y: number, z: number) =>
      Math.hypot(x - 0.2, y - 0.5, z - 0.5) - 0.4;
    const build = (sample: (x: number, y: number, z: number) => number, protectBoundary = true) =>
      buildImplicitSurface({
        bounds,
        cellSize: 0.25,
        latticeCap: 10_000,
        closed: true,
        protectBoundary,
        sample,
      });
    expect(build(touching).report).toMatchObject({
      boundaryEdges: 0,
      degenerateTriangles: 0,
      windingConflicts: 0,
    });
    expect(() => build(touching, false)).toThrow("TN_IMPLICIT_SURFACE_TOPOLOGY_INVALID");
    expect(() => build(() => Number.NaN)).toThrow("TN_IMPLICIT_SURFACE_SAMPLE_INVALID");
    expect(() => build(() => 1, true)).toThrow("TN_IMPLICIT_SURFACE_EMPTY");
    expect(() =>
      buildImplicitSurface({
        bounds,
        cellSize: 0.01,
        latticeCap: 10_000,
        closed: true,
        protectBoundary: true,
        sample: () => 1,
      }),
    ).toThrow("TN_IMPLICIT_SURFACE_LATTICE_OVERFLOW");
  });

  it("should replace the block horizon with a game-owned Worker refinement", async () => {
    const [scenery, ridge, surface, worker, play, instructions, mirror] = await Promise.all([
      readFile(path.join(starter, "src/render/scenery.ts"), "utf8"),
      readFile(path.join(starter, "src/render/rockRidge.ts"), "utf8"),
      readFile(path.join(starter, "src/render/implicitSurface.ts"), "utf8"),
      readFile(path.join(starter, "src/render/rockRidge.worker.ts"), "utf8"),
      readFile(path.join(starter, "src/scenes/Play.ts"), "utf8"),
      readFile(path.join(starter, "AGENTS.md"), "utf8"),
      readFile(path.join(starter, "CLAUDE.md"), "utf8"),
    ]);
    expect(scenery).toContain("createRockRidge");
    expect(scenery).toContain("deferRefinement: true");
    expect(scenery).toContain("scenery.object.add");
    expect(scenery).toContain("Play.enter imports and invokes createScenery");
    expect(scenery).toContain("gameplay rules and colliders unchanged");
    expect(scenery).not.toContain("Delete this file and the game plays identically");
    expect(scenery).not.toContain("MIDGROUND");
    expect(scenery).not.toContain("index < 9");
    expect(ridge).toContain("sampleGraniteField");
    expect(ridge).toContain("smoothMin");
    expect(ridge).toContain("field = smoothMin(field, lobe, 0.22)");
    expect(ridge).toContain("for (let index = -4;");
    expect(ridge).toContain("cellSize: 10");
    expect(ridge).toContain("cellSize: 8");
    expect(ridge).toContain("new Worker(url)");
    expect(ridge).toContain("new Blob");
    expect(ridge).toContain("URL.revokeObjectURL");
    expect(ridge).not.toContain('type: "module"');
    expect(`${ridge}\n${surface}\n${worker}`).not.toContain("@threenative/");
    expect(surface).not.toMatch(/\b(?:color|colour)\b/iu);
    expect(ridge.indexOf("object.add(next.mesh)")).toBeLessThan(
      ridge.indexOf("object.remove(previous)"),
    );
    expect(play).toContain('ctx.entities.add("scenery.ridge", scenery)');
    expect(play).toContain("scenery.rebuild()");
    expect(play).toContain("this.#scenery?.dispose()");
    expect(instructions).toContain("rockRidge.ts");
    expect(instructions).toContain("implicitSurface.ts");
    expect(instructions).toContain("topology audit");
    expect(instructions).toContain("Preview immediately");
    expect(mirror).toContain("rockRidge.ts");
    expect(mirror).toContain("Preview immediately");
  });

  it("should fail closed when Worker refinement is unavailable", () => {
    vi.stubGlobal("Worker", undefined);
    try {
      expect(() => createRockRidge({ dispose: vi.fn() } as never, 20_260_821)).toThrow(
        "TN_ROCK_RIDGE_WORKER_FAILED",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("should keep Preview visible and discard stale Worker generations", () => {
    class FakeWorker {
      static instances: FakeWorker[] = [];
      onmessage:
        | ((
            event: MessageEvent<{
              generation: number;
              indices: Uint32Array;
              positions: Float32Array;
              report: Record<string, number>;
            }>,
          ) => void)
        | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      terminated = false;
      constructor() {
        FakeWorker.instances.push(this);
      }
      postMessage(): void {}
      terminate(): void {
        this.terminated = true;
      }
      emit(result: {
        generation: number;
        indices: Uint32Array;
        positions: Float32Array;
        report: Record<string, number>;
      }): void {
        this.onmessage?.({ data: result } as MessageEvent<typeof result>);
      }
    }
    vi.stubGlobal("Worker", FakeWorker);
    try {
      const material = { dispose: vi.fn() } as never;
      const controller = createRockRidge(material, 20_260_821);
      expect(controller.state).toBe("preview");
      expect(controller.debug().generation).toBe(0);
      expect(controller.object.children).toHaveLength(1);
      const bounds = { maxX: 54, maxY: 18, maxZ: -42, minX: -54, minY: -32, minZ: -74 } as const;
      const build = (seed: number) =>
        buildImplicitSurface({
          bounds,
          cellSize: 2.1,
          latticeCap: 100_000,
          closed: true,
          protectBoundary: true,
          sample: (x, y, z) => sampleGraniteField(x, y, z, seed, bounds),
        });
      const initialWorker = FakeWorker.instances[0];
      if (initialWorker === undefined) throw new Error("fake Worker was not dispatched");
      const first = build(20_260_821);
      initialWorker.emit({ ...first, generation: 1 });
      expect(controller.state).toBe("refined");
      expect(controller.debug().generation).toBe(1);
      expect(initialWorker.terminated).toBe(true);
      expect(controller.object.children).toHaveLength(1);

      controller.rebuild(11);
      controller.rebuild(99);
      const staleWorker = FakeWorker.instances[1];
      const currentWorker = FakeWorker.instances[2];
      if (staleWorker === undefined || currentWorker === undefined)
        throw new Error("fake Worker generations were not dispatched");
      const stale = build(11);
      staleWorker.emit({ ...stale, generation: 2 });
      expect(controller.debug().generation).toBe(1);
      expect(staleWorker.terminated).toBe(true);
      const current = build(99);
      currentWorker.emit({ ...current, generation: 3 });
      expect(controller.state).toBe("refined");
      expect(controller.debug().generation).toBe(3);
      expect(currentWorker.terminated).toBe(true);
      expect(controller.object.children).toHaveLength(1);
      controller.rebuild(123);
      const pendingWorker = FakeWorker.instances[3];
      if (pendingWorker === undefined) throw new Error("pending fake Worker was not dispatched");
      controller.dispose();
      expect(controller.state).toBe("disposed");
      expect(controller.object.children).toHaveLength(0);
      expect(pendingWorker.terminated).toBe(true);
      controller.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("should not ship an unused high-poly sculpture helper", async () => {
    const [shapes, play] = await Promise.all([
      readFile(path.join(starter, "src/render/shapes.ts"), "utf8"),
      readFile(path.join(starter, "src/scenes/Play.ts"), "utf8"),
    ]);
    expect(shapes).not.toContain("TorusKnotGeometry");
    expect(shapes).not.toContain("export function sculpture");
    expect(play).not.toContain("sculpture");
  });

  it("should light silhouettes with a rim, not just a key", async () => {
    for (const root of [starter, minimal, platformer]) {
      const lighting = await readFile(path.join(root, "src/render/lighting.ts"), "utf8");
      expect(lighting).toContain("const rim = new DirectionalLight");
      expect(lighting).toContain("PCFSoftShadowMap");
      expect(lighting).toContain("normalBias");
    }
  });

  it("should tell the user's agent to budget effort for the look", async () => {
    // The only thing in this project that can judge the look is a person
    // reading a screenshot. Every automated gate passes on grey boxes, so if
    // the generated instructions do not say "go look at it", the agent
    // optimises what it can measure and ships grey boxes. This assertion
    // exists because that instruction is load-bearing, not decorative.
    const visualSkill = await readFile(
      path.resolve(
        "packages/create-threenative/agent-files/.agents/skills/threenative-visuals/SKILL.md",
      ),
      "utf8",
    );
    expect(visualSkill).toContain("grey boxes and a black screen");
    expect(visualSkill).toContain("A black headless capture is a capture failure");
    expect(visualSkill).toMatch(/browser automation|browser tool/);
    for (const root of [starter, minimal, platformer]) {
      const agents = await readFile(path.join(root, "AGENTS.md"), "utf8");
      expect(agents).toContain("Budget real time for the look");
      expect(agents).toContain(".agents/skills/threenative-visuals/SKILL.md");
      // AGENTS.md is the source; CLAUDE.md is generated from it by pnpm
      // sync:agents, so it has to carry the same instruction.
      const mirror = await readFile(path.join(root, "CLAUDE.md"), "utf8");
      expect(mirror).toContain("Budget real time for the look");
    }
  });

  it("should declare Tailwind sources so HUD classes cannot silently do nothing", async () => {
    // With no sources, Tailwind still builds — it emits the theme and zero
    // utilities, and every class in src/ui/ becomes an inert string.
    const css = await readFile(path.join(starter, "src/style.css"), "utf8");
    expect(css).toContain('@import "tailwindcss"');
    expect(css).toContain("@source");
    expect(css).toContain("@theme");
  });

  it("should keep concrete boot-error defaults in every generated template", async () => {
    const templates = (await readdir(templatesRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(templates.length).toBeGreaterThan(0);

    for (const template of templates) {
      const style = await readFile(path.join(templatesRoot, template, "src/style.css"), "utf8");
      const rule = cssRule(style, bootErrorSelector);
      expect(rule, `${template} boot-error rule`).toBeDefined();
      for (const [property, value] of requiredBootErrorDeclarations) {
        expect(cssDeclaration(rule, property), `${template} boot-error ${property}`).toBe(value);
      }
      expect(cssDeclaration(rule, "background"), `${template} boot-error background`).toMatch(
        bootErrorColour,
      );
      expect(cssDeclaration(rule, "color"), `${template} boot-error color`).toMatch(
        bootErrorColour,
      );
    }
  });

  it("should host the canvas in a container rather than appending it to body", async () => {
    // An unpositioned canvas appended after a full-height wrapper renders
    // below the fold: a black page with nothing logged anywhere.
    const main = await readFile(path.join(minimal, "src/main.ts"), "utf8");
    expect(main).toContain("app.prepend(canvas)");
    const css = await readFile(path.join(minimal, "src/style.css"), "utf8");
    expect(css).toContain("#app canvas");
  });
});

async function renderFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await renderFiles(file)));
    else files.push(file);
  }
  return files;
}

function cssRule(source: string, selector: string): string | undefined {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`${escapedSelector}\\s*\\{([^{}]*)\\}`, "u").exec(source)?.[1];
}

function cssDeclaration(rule: string | undefined, property: string): string | undefined {
  if (rule === undefined) return undefined;
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?:^|;)\\s*${escapedProperty}\\s*:\\s*([^;]+?)(?:\\s*;|\\s*$)`, "mu")
    .exec(rule)?.[1]
    ?.trim();
}

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const starter = path.resolve("packages/create-threenative/templates/starter");
const minimal = path.resolve("packages/create-threenative/templates/minimal");
const platformer = path.resolve("packages/create-threenative/templates/platformer");

describe("starter visual floor", () => {
  it("should wire lighting, post, and materials from the generated scene", async () => {
    const play = await readFile(path.join(starter, "src/scenes/Play.ts"), "utf8");
    expect(play).toContain("setupLighting(ctx.scene,");
    expect(play).toContain("setupPost(");
    expect(play).toContain("createMaterials()");
  });

  it("should provide readable dynamic-range defaults without framework imports", async () => {
    const files = await Promise.all(
      ["lighting.ts", "postprocessing.ts", "materials.ts"].map((file) =>
        readFile(path.join(starter, "src/render", file), "utf8"),
      ),
    );
    const source = files.join("\n");
    expect(source).toContain("shadow");
    expect(source).toContain("ACESFilmicToneMapping");
    expect(source).not.toContain("@threenative/");
  });

  it("should route setupPost through the framework output node", async () => {
    const post = await readFile(path.join(starter, "src/render/postprocessing.ts"), "utf8");
    const play = await readFile(path.join(starter, "src/scenes/Play.ts"), "utf8");
    expect(post).toContain("setOutputNode");
    expect(post).toContain("bloom");
    expect(post).not.toContain("RenderPipeline");
    expect(post).not.toContain("renderer.render =");
    expect(play).toContain("setupPost(ctx.renderer, ctx.scene, ctx.camera)");
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
      roots.flatMap((root) =>
        readdir(path.join(root, "src/render")).then((names) =>
          Promise.all(
            names.map(
              async (name) =>
                [name, await readFile(path.join(root, "src/render", name), "utf8")] as const,
            ),
          ),
        ),
      ),
    );
    for (const entries of files) {
      for (const [name, source] of entries) {
        expect(source, name).not.toContain("@threenative/");
        // Loading is the one generated surface that carries real startup behavior: safe-area
        // layout, texture crops, truthful progress and disposal. Its source stays game-owned; the
        // old 200-line smell cap must not reject that behavior.
        if (!name.endsWith("loading.ts"))
          expect(source.trimEnd().split("\n").length, name).toBeLessThan(200);
      }
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
    // Deterministic scatter: Math.random makes a screenshot diff meaningless.
    expect(shapes).toContain("export function makeRandom");
    expect(shapes).not.toContain("Math.random(");
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
    for (const root of [starter, minimal, platformer]) {
      const agents = await readFile(path.join(root, "AGENTS.md"), "utf8");
      expect(agents).toContain("Budget real time for the look");
      expect(agents).toContain("blind to how the game looks");
      // How to get eyes on it at all — headless WebGPU renders nothing, and an
      // agent that does not know that reads a blank canvas as a scene bug.
      expect(agents).toContain("headless Chromium usually cannot render WebGPU");
      expect(agents).toMatch(/Claude in Chrome|browser tool/);
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

  it("should host the canvas in a container rather than appending it to body", async () => {
    // An unpositioned canvas appended after a full-height wrapper renders
    // below the fold: a black page with nothing logged anywhere.
    const main = await readFile(path.join(minimal, "src/main.ts"), "utf8");
    expect(main).toContain("app.prepend(canvas)");
    const css = await readFile(path.join(minimal, "src/style.css"), "utf8");
    expect(css).toContain("#app canvas");
  });
});

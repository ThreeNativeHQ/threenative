import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const starter = path.resolve("packages/create-threenative/templates/starter");
const minimal = path.resolve("packages/create-threenative/templates/minimal");

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

  it("should make setupPost execute a real WebGPU render pass", async () => {
    const post = await readFile(path.join(starter, "src/render/postprocessing.ts"), "utf8");
    const play = await readFile(path.join(starter, "src/scenes/Play.ts"), "utf8");
    expect(post).toContain("RenderPipeline");
    expect(post).toContain("new RenderPipeline(renderer, pass(scene, camera))");
    expect(post).toContain("const originalRender = renderer.render.bind(renderer)");
    expect(post).toContain("const pipelineRender = () =>");
    expect(post).toContain("renderer.render = pipelineRender");
    expect(post).toContain("try");
    expect(post).toContain("finally");
    expect(play).toContain("setupPost(ctx.renderer.raw as WebGPURenderer, ctx.scene, ctx.camera)");
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

  it("should keep every generated render file under 20 lines", async () => {
    const roots = [starter, minimal];
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
        expect(source.trimEnd().split("\n").length, name).toBeLessThan(20);
      }
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
    expect(main).toContain("container:");
    const css = await readFile(path.join(minimal, "src/style.css"), "utf8");
    expect(css).toContain("#app canvas");
  });
});

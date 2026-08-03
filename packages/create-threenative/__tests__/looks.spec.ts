import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const starter = path.resolve("packages/create-threenative/templates/starter");
const minimal = path.resolve("packages/create-threenative/templates/minimal");

describe("starter visual floor", () => {
  it("should wire lighting, post, and materials from the generated scene", async () => {
    const play = await readFile(path.join(starter, "src/scenes/Play.ts"), "utf8");
    expect(play).toContain("setupLighting(ctx.scene)");
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

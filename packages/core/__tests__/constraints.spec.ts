import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createReplayDriver } from "../src/replay.js";

const sourceDirectory = path.resolve("packages/core/src");
const randomSource = path.join(sourceDirectory, "random.ts");
const replaySource = path.join(sourceDirectory, "replay.ts");
const indexSource = path.join(sourceDirectory, "index.ts");

describe("core constraints", () => {
  it("should keep visual concerns out of core source", () => {
    const source = readdirSync(sourceDirectory)
      .filter((file) => file.endsWith(".ts"))
      .filter(
        (file) =>
          file !== "config.ts" &&
          file !== "particles.ts" &&
          file !== "projection-plan.ts" &&
          file !== "projection-apply.ts" &&
          file !== "renderProjection.ts" &&
          file !== "renderer.ts" &&
          file !== "react-host.ts" &&
          file !== "warmup.ts" &&
          file !== "tracers.ts" &&
          file !== "gpu-scene-bvh.ts" &&
          file !== "index.ts",
      )
      .map((file) => readFileSync(path.join(sourceDirectory, file), "utf8"))
      .join("\n");

    expect(source).not.toMatch(/material|light|tonemapping|postprocessing|\.wgsl/iu);

    // `config.ts` is exempted on the same terms: it declares option NAMES a game types
    // (`assets.targets.maxMaterials`), measures nothing, and originates no visual concern.

    // `warmup.ts` is exempted on the same terms as the projection files: it reads a material's
    // *identity* to tell one pipeline from another, so that compiling one wall warms every wall
    // sharing its material. It never constructs a material, never configures one, and never reads
    // a property that describes how anything looks. The assertions below are what keep that true:
    // the moment it makes an appearance decision, this fails.
    const warmup = readFileSync(path.join(sourceDirectory, "warmup.ts"), "utf8");
    expect(warmup).not.toMatch(/new\s+\w*(Material|Light)|tonemapping|postprocessing|\.wgsl/iu);
    expect(warmup).not.toMatch(/\.(color|map|roughness|metalness|emissive|opacity|envMap)\b/iu);
    expect(warmup.match(/#[0-9a-f]{6}\b|0x[0-9a-f]{6}\b/giu)).toBeNull();

    // `react-host.ts` is exempted on the same terms as particles, and needs to be: a renderer that
    // draws nothing has to construct the one material its quads are drawn with. What it must never
    // do is decide what that material looks like. Every colour it sets is read off the game's own
    // `style` prop, the geometry is a unit plane the game never sees, and the two constants below
    // are the fallback white for a missing colour and the red of the failure banner — diagnostics,
    // in the same category as `DebugOverlay`, not an appearance the framework is choosing.
    const reactHost = readFileSync(path.join(sourceDirectory, "react-host.ts"), "utf8");
    expect(reactHost).not.toMatch(/new\s+\w*Light|tonemapping|postprocessing|\.wgsl/iu);
    expect([...new Set(reactHost.match(/#[0-9a-f]{6}\b|0x[0-9a-f]{6}\b/giu))]).toEqual([
      "0xffffff",
      "#ff5f4d",
    ]);

    const particles = readFileSync(path.join(sourceDirectory, "particles.ts"), "utf8");
    expect(particles).not.toMatch(
      /new\s+\w*Material|new\s+Color|light|tonemapping|postprocessing|\.wgsl/iu,
    );

    // `renderProjection.ts` is exempted on exactly the same terms, and needs the exemption for a
    // sharper reason than particles did: it maintains a private mirror of the game's scene, so
    // it has to name every kind of thing that scene can hold. What it must never do is originate
    // one. Every material it draws with is the game's own instance, passed through by reference so
    // that recolouring the original recolours the batch; every light in the mirror is a clone of a
    // light the game built, kept in step with it. Constructing either would be the framework
    // deciding how a game looks, which no amount of performance buys back.
    const projection = readFileSync(path.join(sourceDirectory, "renderProjection.ts"), "utf8");
    expect(projection).not.toMatch(
      /new\s+\w*Material|new\s+\w*Light|new\s+Color|tonemapping|postprocessing|\.wgsl/iu,
    );
    // It must recognise a light: the mirror is a separate graph, and a mirror with no lights in
    // it renders every lit surface black. Since P2-3 the recognition lives in the scan seam.

    // The P2-3 split moved the scan/plan and the mirror into `projection-plan.ts` and
    // `projection-apply.ts`; the renderProjection exemption follows the code, on exactly the
    // same terms. The plan names lights only to classify them; the apply seam clones the game's
    // own lights and passes the game's own geometry and material by reference. Neither may
    // originate an appearance, and the light classification must stay somewhere.
    for (const splitModule of ["projection-plan.ts", "projection-apply.ts"] as const) {
      const projectionPart = readFileSync(path.join(sourceDirectory, splitModule), "utf8");
      expect(projectionPart).not.toMatch(
        /new\s+\w*Material|new\s+\w*Light|new\s+Color|tonemapping|postprocessing|\.wgsl/iu,
      );
    }
    expect(readFileSync(path.join(sourceDirectory, "projection-plan.ts"), "utf8")).toMatch(
      /isLight/u,
    );

    // `renderer.ts` is exempted because `prewarm` must inspect and clone the game's own render
    // surfaces to compile them early. It does not construct a surface or choose its appearance.
    const renderer = readFileSync(path.join(sourceDirectory, "renderer.ts"), "utf8");
    expect(renderer).not.toMatch(
      /new\s+\w*Material|new\s+\w*Light|new\s+Color|tonemapping|postprocessing|\.wgsl/iu,
    );

    // `tracers.ts` is exempted on the same terms: a pooled travelling streak must name and fade
    // the surface it moves. It constructs none — the surface comes from the game (required),
    // cloned per slot so each streak can fade independently — and any geometry beyond the
    // neutral unit cylinder is the game's too.
    const tracers = readFileSync(path.join(sourceDirectory, "tracers.ts"), "utf8");
    expect(tracers).not.toMatch(
      /new\s+\w*Material|new\s+\w*Light|new\s+Color|tonemapping|postprocessing|\.wgsl/iu,
    );

    // `gpu-scene-bvh.ts` is exempted on the same terms as `warmup.ts`: it reads a material's
    // *identity* — an integer index into the game's own surfaces — to pack triangles for the BVH's
    // leaf order. It never constructs a material and never reads a property that describes how
    // anything looks. The assertions below keep that true.
    const sceneBvh = readFileSync(path.join(sourceDirectory, "gpu-scene-bvh.ts"), "utf8");
    expect(sceneBvh).not.toMatch(/new\s+\w*(Material|Light)|tonemapping|postprocessing|\.wgsl/iu);
    expect(sceneBvh).not.toMatch(/\.(color|map|roughness|metalness|emissive|opacity|envMap)\b/iu);
    expect(sceneBvh.match(/#[0-9a-f]{6}\b|0x[0-9a-f]{6}\b/giu)).toBeNull();

    // The public surface may NAME the types it re-exports (`IGPUSceneBVHMaterialGroup` is a data
    // group, not a look); what it may never do is originate an appearance.
    expect(indexSource).not.toMatch(
      /new\s+\w*Material|new\s+\w*Light|new\s+Color|tonemapping|postprocessing|\.wgsl/iu,
    );
  });

  /**
   * There is deliberately no line-count assertion here.
   *
   * A fatal 2,500-line cap lived at this spot and was removed on 2026-08-09. It appeared
   * nowhere in `CHARTER.md`, `AGENTS.md` or `pnpm budgets`, while the two LOC limits the
   * charter does state (15,000 framework, 50,000 native) are review triggers that report and
   * never fail. Core had reached 2,499 of 2,500, so the only fatal LOC number in the repo was
   * an unwritten one, and it blocked the next twenty lines of plumbing on arrival order
   * rather than on merit — while counting blank lines and comments, which taxes exactly the
   * package that most needs explaining.
   *
   * What guards framework weight is `scripts/count-loc.ts`, which scores whether the
   * framework costs more code than plain Three.js, and the reported trigger in
   * `pnpm budgets`. A ceiling on core belongs there, next to the other numbers, not as a
   * fatal per-package test. See `docs/PRDs/PRD-053-core-input-multitouch.md`.
   */

  it("should reject a recording schema key that names an entity type", () => {
    const source = readFileSync(replaySource, "utf8");
    expect(source).not.toMatch(/"(type|class|kind|prefab|components|nodes)"/u);
    expect(source).not.toMatch(/new (\w+\[|constructors?\[|registry\.get)/u);
    expect(source).not.toContain("EntitySnapshot");

    const recording = {
      input: [],
      randomState: 0,
      runtime: { agent: "node", core: "0.1.0", rapier: null, step: 1 / 60 },
      seed: 1,
      ticks: 1,
      version: 1,
    };
    const validRecording = { ...recording, input: [{ keys: [], tick: 0 }] };
    expect(() =>
      createReplayDriver({ ...validRecording, type: "entity" } as never, new EventTarget()),
    ).toThrow(/unknown key 'type'/u);
  });

  it("should keep the saveable random state on the public surface", () => {
    expect(readFileSync(randomSource, "utf8")).toMatch(/state:\s*number/u);
  });

  it("should keep the replay exports on the public surface", () => {
    const source = readFileSync(indexSource, "utf8");
    expect(source).toContain('export { createReplayDriver, replay } from "./replay.js";');
    expect(source).toContain('export type { IReplayOptions, Recording } from "./replay.js";');
  });
});

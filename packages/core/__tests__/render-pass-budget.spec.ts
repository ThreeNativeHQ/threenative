import { describe, expect, it } from "vitest";
import {
  FRAME_PASS_KINDS,
  type IRenderPassSample,
  RenderPassBudget,
} from "../src/render-pass-budget.js";

/**
 * A renderer whose `render` adds its own submission to `info.render` and then, like three's own
 * nested passes, calls itself for each nested scene. `info.render` is never reset here: the whole
 * point is that a nested render shares the aggregate, so attribution has to subtract the children.
 */
interface IFakeScene {
  readonly name: string;
  readonly nested?: readonly IFakeScene[];
  readonly submissions: { readonly draws: number; readonly triangles: number };
}

interface IFakeRenderer {
  info: { render: { calls: number; drawCalls: number; triangles: number } };
  render(scene: IFakeScene, camera: object): void;
}

function fakeRenderer(): IFakeRenderer {
  const raw: IFakeRenderer = {
    info: { render: { calls: 0, drawCalls: 0, triangles: 0 } },
    render(this: IFakeRenderer, scene: IFakeScene, _camera: object): void {
      this.info.render.drawCalls += scene.submissions.draws;
      this.info.render.triangles += scene.submissions.triangles;
      for (const child of scene.nested ?? []) this.render(child, {});
    },
  };
  return raw;
}

const MAIN: IFakeScene = { name: "", submissions: { draws: 0, triangles: 0 } };
const SHADOW: IFakeScene = {
  name: "Shadow Map [ Sun ]",
  submissions: { draws: 4, triangles: 40 },
};
const REFLECTION: IFakeScene = {
  name: "Scene [ Reflector ]",
  submissions: { draws: 6, triangles: 60 },
};

function passesOf(budget: RenderPassBudget): readonly IRenderPassSample[] {
  return budget.passes();
}

describe("render pass budget", () => {
  it("should attribute each nested render to its innermost active call", () => {
    const raw = fakeRenderer();
    const budget = RenderPassBudget.install(raw);
    expect(budget).toBeDefined();

    budget?.beginFrame();
    raw.render(
      { ...MAIN, submissions: { draws: 10, triangles: 100 }, nested: [SHADOW, REFLECTION] },
      {},
    );
    const passes = passesOf(budget as RenderPassBudget);
    const byKind = Object.fromEntries(passes.map((pass) => [pass.kind, pass]));

    // The aggregate at world-render end is main+shadow+reflection combined.
    expect(raw.info.render.drawCalls).toBe(20);
    expect(raw.info.render.triangles).toBe(200);
    expect(byKind.main).toMatchObject({ draws: 10, triangles: 100 });
    expect(byKind.shadow).toMatchObject({ draws: 4, triangles: 40 });
    expect(byKind.reflection).toMatchObject({ draws: 6, triangles: 60 });
    expect(passes.reduce((sum, pass) => sum + pass.draws, 0)).toBe(20);
  });

  it("should read the WebGL2 fallback's calls counter", () => {
    // WebGL2 reports `calls` rather than WebGPU's `drawCalls`.
    const fallback = {
      info: { render: { calls: 0, triangles: 0 } },
      render(
        this: { info: { render: { calls: number; triangles: number } } },
        scene: IFakeScene,
      ): void {
        this.info.render.calls += scene.submissions.draws;
        this.info.render.triangles += scene.submissions.triangles;
      },
    };
    const budget = RenderPassBudget.install(fallback);
    expect(budget).toBeDefined();
    budget?.beginFrame();
    fallback.render({ ...MAIN, submissions: { draws: 3, triangles: 30 } });
    expect(passesOf(budget as RenderPassBudget)).toMatchObject([
      { draws: 3, kind: "main", triangles: 30 },
    ]);
  });

  it("should clear the frame's passes on beginFrame and name the known kinds", () => {
    expect(FRAME_PASS_KINDS).toEqual(["main", "shadow", "reflection", "nested"]);
    const raw = fakeRenderer();
    const budget = RenderPassBudget.install(raw) as RenderPassBudget;
    budget.beginFrame();
    raw.render({ ...MAIN, submissions: { draws: 1, triangles: 1 } }, {});
    expect(passesOf(budget)).toHaveLength(1);
    budget.beginFrame();
    expect(passesOf(budget)).toHaveLength(0);
  });

  it("should refuse to install on a renderer that cannot count its own submissions", () => {
    const raw = { render: (): void => undefined } as unknown as Parameters<
      typeof RenderPassBudget.install
    >[0];
    expect(RenderPassBudget.install(raw)).toBeUndefined();
  });
});

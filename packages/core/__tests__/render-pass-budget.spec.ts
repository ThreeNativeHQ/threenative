import { describe, expect, it } from "vitest";
import { FrameBudget } from "../src/frame-budget.js";
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

  it("attributes resolved per-pass GPU time to main and shadow, not the parent", () => {
    // Three allocates one timestamp uid per render pass at `beginRenderPass`, and renders shadow
    // passes before the colour pass, so the nested render's uid lands first. The pool is three's
    // own shape: `queryOffsets` is allocation order, `timestamps` fills in on the async resolve.
    const pool = {
      queryOffsets: new Map<string, number>(),
      timestamps: new Map<string, number>(),
    };
    const frame = 7;
    let allocation = 0;
    const calls = { value: 0 };
    interface IFakeGpuRenderer {
      backend: {
        timestampQueryPool: {
          render: { queryOffsets: Map<string, number>; timestamps: Map<string, number> };
        };
      };
      info: { render: { calls: number; drawCalls: number; triangles: number } };
      render(scene: IFakeScene, camera: object): void;
    }
    const raw: IFakeGpuRenderer = {
      backend: { timestampQueryPool: { render: pool } },
      info: { render: { calls: 0, drawCalls: 0, triangles: 0 } },
      render: (scene: IFakeScene, _camera: object): void => {
        for (const child of scene.nested ?? []) raw.render(child, {});
        allocation += 1;
        pool.queryOffsets.set(
          `r:${calls.value}:${allocation}:f${frame}`,
          pool.queryOffsets.size * 2,
        );
        raw.info.render.drawCalls += scene.submissions.draws;
        raw.info.render.triangles += scene.submissions.triangles;
      },
    };
    const budget = RenderPassBudget.install(raw) as RenderPassBudget;
    budget.beginFrame();
    raw.render({ ...MAIN, submissions: { draws: 10, triangles: 100 }, nested: [SHADOW] }, {});
    // Nothing resolves until three's pool has been read back.
    expect(budget.nextGpuFrame()).toBeUndefined();
    const uids = [...pool.queryOffsets.keys()];
    expect(uids).toHaveLength(2);
    const [shadowUid, mainUid] = uids;
    if (shadowUid === undefined || mainUid === undefined)
      throw new Error("fake backend allocated fewer than two timestamp uids");
    pool.timestamps.set(shadowUid, 2.25); // nested shadow, allocated first
    pool.timestamps.set(mainUid, 5.5); // main
    // Main must not absorb the shadow's pass: the split is 5.5 and 2.25, not 7.75 and 0, and the
    // frame's own cost is both of them rather than the one number three's resolve returns.
    expect(budget.nextGpuFrame()).toEqual({
      frame,
      main: 5.5,
      shadow: 2.25,
      total: 7.75,
    });
    // One reading per frame: the same frame is not handed out twice.
    expect(budget.nextGpuFrame()).toBeUndefined();
  });

  it("reports the GPU-selected main-pass triangles beside the CPU capacity figure", () => {
    // Three adds `instanceCount * (count / 3)` per draw, and for an indirect batch `count` is the
    // merged geometry's capacity, not what the GPU selected -- so a streamed world reads as hundreds
    // of millions of triangles for a few hundred thousand drawn. The window already carries the
    // honest number as `mainGpuTriangles`; a reader who only has the pass record cannot see which
    // of the two they are holding, so the GPU figure belongs beside the CPU one in the pass too.
    const raw = fakeRenderer();
    const passBudget = RenderPassBudget.install(raw) as RenderPassBudget;
    const budget = new FrameBudget({
      readGpuTally: () => ({ instances: 12_000, triangles: 402_000 }),
      report: () => undefined,
      reportEvery: 1000,
    });
    let now = 0;
    for (let frame = 0; frame < 4; frame += 1) {
      now += 16.7;
      budget.beginFrame(now, now);
      passBudget.beginFrame();
      raw.render({ ...MAIN, submissions: { draws: 30, triangles: 338_000_000 } }, {});
      budget.addRenderPasses(passBudget.passes());
      budget.markSimulationEnd(now, 1);
      budget.endFrame(now + 1);
    }

    const main = budget.window().passes?.main;
    expect(main?.triangles.p50).toBe(338_000_000);
    expect(main?.gpuTriangles).toBe(402_000);
  });
});

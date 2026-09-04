import { describe, expect, it } from "vitest";
import { createRenderer } from "../src/renderer.js";

function testCanvas(): HTMLCanvasElement {
  const canvas = new EventTarget() as EventTarget & Partial<HTMLCanvasElement>;
  Object.defineProperties(canvas, {
    clientHeight: { configurable: true, value: 180 },
    clientWidth: { configurable: true, value: 320 },
    parentElement: { configurable: true, value: null },
  });
  return canvas as HTMLCanvasElement;
}

/** A leaf card: opaque, cut out by an alpha test — the one shape MSAA alone cannot antialias. */
function cutout() {
  return { alphaTest: 0.5, alphaToCoverage: false, transparent: false };
}

function meshWith(material: unknown) {
  return {
    isMesh: true,
    material,
    traverse(callback: (object: unknown) => void) {
      callback(this);
    },
    visible: true,
  } as unknown as never;
}

async function renderer(
  options: { alphaAntialiasing?: boolean; samples?: number } = {},
  extra: Record<string, unknown> = {},
) {
  const canvas = testCanvas();
  const lines: string[] = [];
  const created = await createRenderer({
    alphaAntialiasing: options.alphaAntialiasing,
    antialias: true,
    canvas,
    preferWebGPU: false,
    report: (line) => lines.push(line),
    webgl2Factory: () => ({
      compileAsync: async () => undefined,
      domElement: canvas,
      render: () => undefined,
      ...(options.samples === undefined ? {} : { samples: options.samples }),
      setSize: () => undefined,
      ...extra,
    }),
  });
  return { created, lines };
}

describe("alpha antialiasing", () => {
  // The defect this exists for, measured before it was written: `antialias: true` really does buy
  // a 4x multisampled target — a WebGPU capture of a full post chain shows every attachment at
  // sampleCount 4 — and a cutout silhouette made by `discard` spends none of it. The game pays
  // the bandwidth every frame and the distant tree line is still a black-and-white stipple.
  it("puts cutout materials on the coverage mask the multisampled surface already pays for", async () => {
    const { created } = await renderer({ samples: 4 });
    const material = cutout();
    await created.compileAsync(meshWith(material), {} as never);
    expect(material.alphaToCoverage).toBe(true);
    expect(created.alphaAntialiasing?.()).toMatchObject({
      applied: true,
      materials: 1,
      reason: "",
      sampleCount: 4,
    });
    created.dispose();
  });

  // Alpha-to-coverage without a coverage mask is the same silent no-op pointing the other way:
  // three keeps the smoothstep and drops the hard discard, so a single-sampled surface gets
  // fattened silhouettes and no antialiasing at all. Refuse, and say what would fix it.
  it("refuses on a single-sampled surface and names the reason", async () => {
    const { created } = await renderer({ samples: 0 });
    const material = cutout();
    await created.compileAsync(meshWith(material), {} as never);
    expect(material.alphaToCoverage).toBe(false);
    expect(created.alphaAntialiasing?.()).toMatchObject({
      applied: false,
      materials: 0,
      sampleCount: 1,
    });
    expect(created.alphaAntialiasing?.().reason).toContain("single-sampled");
    created.dispose();
  });

  it("stays off when the game turns it off, and still reports the surface it measured", async () => {
    const { created } = await renderer({ alphaAntialiasing: false, samples: 4 });
    const material = cutout();
    await created.compileAsync(meshWith(material), {} as never);
    expect(material.alphaToCoverage).toBe(false);
    expect(created.alphaAntialiasing?.()).toMatchObject({
      applied: false,
      materials: 0,
      reason: "renderer.alphaAntialiasing is false",
      sampleCount: 4,
    });
    created.dispose();
  });

  it("leaves blended and untested materials alone", async () => {
    const { created } = await renderer({ samples: 4 });
    const blended = { alphaTest: 0.5, alphaToCoverage: false, transparent: true };
    const plain = { alphaTest: 0, alphaToCoverage: false, transparent: false };
    await created.compileAsync(meshWith([blended, plain]), {} as never);
    expect(blended.alphaToCoverage).toBe(false);
    expect(plain.alphaToCoverage).toBe(false);
    expect(created.alphaAntialiasing?.().materials).toBe(0);
    created.dispose();
  });

  // Foliage streams in after warm-up. A convention that only ran at warm-up would leave every
  // late tree stippled — which is the tree line this was measured against.
  it("catches a material that first appears at draw time, before its pipeline is built", async () => {
    const drawn: unknown[] = [];
    let hook: ((...args: unknown[]) => void) | undefined;
    const { created } = await renderer(
      { samples: 4 },
      {
        getRenderObjectFunction: () => null,
        renderObject: (...args: unknown[]) => drawn.push(args),
        setRenderObjectFunction: (fn: (...args: unknown[]) => void) => {
          hook = fn;
        },
      },
    );
    expect(hook).toBeTypeOf("function");
    const material = cutout();
    hook?.({}, {}, {}, {}, material, null, null, null, null);
    expect(material.alphaToCoverage).toBe(true);
    expect(drawn).toHaveLength(1);
    created.dispose();
  });

  it("prints one marker line naming what it decided", async () => {
    const { created, lines } = await renderer({ samples: 4 });
    await created.compileAsync(meshWith(cutout()), {} as never);
    await created.compileAsync(meshWith(cutout()), {} as never);
    const markers = lines.filter((line) => line.startsWith("TN_ALPHA_ANTIALIASING:"));
    expect(markers).toHaveLength(1);
    expect(JSON.parse(markers[0]?.slice("TN_ALPHA_ANTIALIASING:".length) ?? "{}")).toMatchObject({
      applied: true,
      sampleCount: 4,
    });
    created.dispose();
  });
});

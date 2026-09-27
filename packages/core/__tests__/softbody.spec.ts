import { BufferAttribute, BufferGeometry, Group, Matrix4, Mesh, MeshBasicMaterial } from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import type { IRendererLike } from "../src/renderer.js";
import {
  SoftBody3D,
  buildClothTopology,
  compactClothVec3Readback,
  simulateClothReference,
} from "../src/softbody.js";

function exportedFlagGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(
      new Float32Array([
        0, 1.4, 0, 1.1, 1.2, 0.1, 0.9, 0.1, -0.05, 0, 1.4, 0, 0.9, 0.1, -0.05, -0.1, 0, 0.08,
      ]),
      3,
    ),
  );
  geometry.setIndex([0, 1, 2, 3, 4, 5]);
  return geometry;
}

const microtasks = async (count = 8): Promise<void> => {
  for (let index = 0; index < count; index += 1) await Promise.resolve();
};

function flagOptions(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    damping: 1.8,
    gravity: [0, -9.81, 0],
    pinned: [0, 3],
    stiffness: 35,
    wind: [1.5, 0, 0.4],
    ...overrides,
  };
}

function buildCloth(overrides: Record<string, unknown> = {}): SoftBody3D {
  const mesh = new Mesh(exportedFlagGeometry(), new MeshBasicNodeMaterial());
  return new SoftBody3D(mesh, flagOptions(overrides) as never);
}

function renderer(dispatched: unknown[]): IRendererLike {
  return {
    compileAsync: async () => undefined,
    compute: (node) => dispatched.push(node),
    dispose: () => undefined,
    domElement: new EventTarget() as HTMLCanvasElement,
    gpuFrameMs: () => undefined,
    info: {},
    kind: "webgpu",
    raw: {},
    readback: async () => new ArrayBuffer(64),
    render: () => undefined,
    renderOverlay: () => undefined,
    resolveGpuFrame: () => undefined,
    setOutputNode: () => undefined,
    setResolutionScale: () => undefined,
    setSize: () => undefined,
    surface: () => ({
      atFloor: false,
      drawingBufferHeight: 1,
      drawingBufferWidth: 1,
      resolutionScale: 1,
      sampleCount: 1,
      scaleSource: "pinned",
    }),
  };
}

describe("SoftBody3D cloth", () => {
  it("compacts WGSL-padded vec3 readback and rejects every other shape", () => {
    expect(compactClothVec3Readback(new Float32Array([1, 2, 3, 99, 4, 5, 6, 99]), 2)).toEqual(
      new Float32Array([1, 2, 3, 4, 5, 6]),
    );
    const packed = new Float32Array([1, 2, 3, 4, 5, 6]);
    const copy = compactClothVec3Readback(packed, 2);
    expect(copy).toEqual(packed);
    expect(copy).not.toBe(packed);
    expect(() => compactClothVec3Readback(new Float32Array(7), 2)).toThrow(
      "expected 6 packed or 8 padded floats",
    );
  });

  it.each([
    ["stiffness NaN", { stiffness: Number.NaN }, /stiffness must be finite/u],
    ["stiffness zero", { stiffness: 0 }, /stiffness must be greater than zero/u],
    ["damping negative", { damping: -1 }, /damping must be non-negative/u],
    ["damping NaN", { damping: Number.NaN }, /damping must be finite/u],
    ["gravity length", { gravity: [0, -9.81] }, /gravity must contain three numbers/u],
    ["gravity non-finite", { gravity: [0, Number.NaN, 0] }, /gravity\.y must be finite/u],
    ["wind length", { wind: [1.5, 0] }, /wind must contain three numbers/u],
    ["wind non-finite", { wind: [1.5, 0, Number.POSITIVE_INFINITY] }, /wind\.z must be finite/u],
    [
      "collision capacity zero",
      { collision: { capacity: 0, writeBoxes: () => 0 } },
      /collision capacity must be a positive integer/u,
    ],
    [
      "fractional collision capacity",
      { collision: { capacity: 1.5, writeBoxes: () => 0 } },
      /collision capacity must be a positive integer/u,
    ],
    [
      "readbackEveryFrames negative",
      { readbackEveryFrames: -1 },
      /readbackEveryFrames must be a non-negative integer/u,
    ],
    [
      "fractional readbackEveryFrames",
      { readbackEveryFrames: 1.5 },
      /readbackEveryFrames must be a non-negative integer/u,
    ],
  ])("fails closed for an invalid %s", (_label, overrides, pattern) => {
    expect(() => buildCloth(overrides)).toThrow(pattern);
  });

  it("rejects a mesh that does not use one game-owned node material", () => {
    const plain = new Mesh(exportedFlagGeometry(), new MeshBasicMaterial());
    expect(() => new SoftBody3D(plain, flagOptions() as never)).toThrow(/node material/u);
    const arrayed = new Mesh(exportedFlagGeometry(), [new MeshBasicNodeMaterial()]);
    expect(() => new SoftBody3D(arrayed, flagOptions() as never)).toThrow(/node material/u);
  });

  it("reports an undefined sample and debug counters before any readback lands", async () => {
    const cloth = buildCloth({ readbackEveryFrames: 1 });
    expect(cloth.sample).toBeUndefined();
    expect(cloth.debug()).toEqual({
      released: false,
      softBodySteps: 0,
      springCount: cloth.springCount,
      uniqueVertexCount: cloth.uniqueVertexCount,
      readbackPending: false,
      readbackStats: { requests: 0, lands: 0, failures: 0 },
      sampleStaleFrames: 0,
    });

    cloth.process(renderer([]));
    expect(cloth.debug().softBodySteps).toBe(1);
    await microtasks();
    expect(cloth.sample?.data).toHaveLength(cloth.uniqueVertexCount * 3);
    expect(cloth.sample?.staleFrames).toBeGreaterThanOrEqual(0);
    cloth.detach();
    expect(cloth.released).toBe(true);
    cloth.process();
    expect(cloth.steps).toBe(1);
  });

  it("guards attach and process edges and releases only its owned clone", () => {
    const cloth = buildCloth();
    expect(() => cloth.process()).toThrow("SoftBody3D is not attached to a renderer.");
    expect(() => cloth.attachRenderer({ ...renderer([]), kind: "webgl" } as never)).toThrow(
      "SoftBody3D requires the WebGPU renderer.",
    );

    const gpu = renderer([]);
    cloth.attachRenderer(gpu);
    cloth.process(gpu);
    const ownedDispose = vi.spyOn(cloth.material, "dispose");
    cloth.detach();
    cloth.detach();
    expect(cloth.released).toBe(true);
    expect(ownedDispose).toHaveBeenCalledOnce();
    expect(() => cloth.attachRenderer(gpu)).toThrow("SoftBody3D cannot be attached after release.");
  });

  it("detaches when the cloth is removed from its scene parent", () => {
    const cloth = buildCloth();
    const parent = new Group();
    parent.add(cloth);
    parent.remove(cloth);
    expect(cloth.released).toBe(true);
  });

  it("packs collision boxes and fails closed on an out-of-range count", () => {
    const seen: Matrix4[] = [];
    const collision = {
      capacity: 1,
      writeBoxes(target: Float32Array, worldToLocal: Matrix4): number {
        seen.push(worldToLocal);
        target.set([0, 0, 0, 0, 1, 1, 1, 0]);
        return 1;
      },
    };
    const cloth = buildCloth({ collision });
    const dispatched: unknown[] = [];
    cloth.attachRenderer(renderer(dispatched));
    cloth.process();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeInstanceOf(Matrix4);
    expect(cloth.steps).toBe(1);

    const overfull = buildCloth({ collision: { capacity: 1, writeBoxes: () => 2 } });
    overfull.attachRenderer(renderer([]));
    expect(() => overfull.process()).toThrow(/expected 0\.\.1/u);
  });

  it("welds duplicated exporter vertices before building unique springs", () => {
    const topology = buildClothTopology(exportedFlagGeometry(), { pinned: [0, 3] });

    expect(topology.positions).toHaveLength(12);
    expect(topology.originalToUnique).toEqual(new Uint32Array([0, 1, 2, 0, 2, 3]));
    expect(topology.springs).toHaveLength(10);
    expect(topology.pinned).toEqual(new Uint32Array([1, 0, 0, 0]));
  });

  it("keeps pinned vertices exact and settles identically across render rates", () => {
    const topology = buildClothTopology(exportedFlagGeometry(), { pinned: [0, 3] });
    const common = {
      damping: 1.8,
      duration: 2,
      gravity: [0, -9.81, 0] as const,
      stiffness: 35,
      topology,
      wind: [1.5, 0, 0.4] as const,
    };
    const at30 = simulateClothReference({ ...common, frameStep: 1 / 30 });
    const at120 = simulateClothReference({ ...common, frameStep: 1 / 120 });

    expect([...at30.slice(0, 3)]).toEqual([...topology.positions.slice(0, 3)]);
    expect([...at120.slice(0, 3)]).toEqual([...topology.positions.slice(0, 3)]);
    expect(
      Math.max(
        ...at30.map((value, index) => {
          const comparison = at120[index];
          if (comparison === undefined) throw new Error(`missing comparison at index ${index}`);
          return Math.abs(value - comparison);
        }),
      ),
    ).toBeLessThan(1e-6);
  });

  it("dispatches its fixed-step solver and releases only mechanism-owned resources", () => {
    const material = new MeshBasicNodeMaterial();
    const mesh = new Mesh(exportedFlagGeometry(), material);
    const cloth = new SoftBody3D(mesh, {
      damping: 1.8,
      gravity: [0, -9.81, 0],
      pinned: [0, 3],
      stiffness: 35,
      wind: [1.5, 0, 0.4],
    });
    const dispatched: unknown[] = [];
    const gpu = renderer(dispatched);
    const geometryDispose = vi.spyOn(mesh.geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");

    cloth.attachRenderer(gpu);
    cloth.process();
    expect(dispatched).toEqual([...cloth.warmupNodes]);
    expect(cloth.steps).toBe(1);
    cloth.detach();

    expect(cloth.released).toBe(true);
    expect(geometryDispose).not.toHaveBeenCalled();
    expect(materialDispose).not.toHaveBeenCalled();
  });
});

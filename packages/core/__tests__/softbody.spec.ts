import { BufferAttribute, BufferGeometry, Mesh } from "three";
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
    readback: async () => new ArrayBuffer(0),
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
    expect(() => compactClothVec3Readback(new Float32Array(7), 2)).toThrow(
      "expected 6 packed or 8 padded floats",
    );
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

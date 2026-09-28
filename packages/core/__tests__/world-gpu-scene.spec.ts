import { Frustum, Matrix4, PerspectiveCamera } from "three";
import { describe, expect, it } from "vitest";
import {
  type IGpuPlacement,
  type IKernelInput,
  type IRegion,
  WorldGpuScene,
  cullAndSelect,
  gpuSceneUnsupported,
} from "../src/world-gpu-scene.js";

/**
 * The GPU scene's per-instance kernel, proved against the CPU path it replaces.
 *
 * The reference is `cullAndSelect` — plain TypeScript, no GPU, the exact branch order the TSL
 * kernel mirrors — so this is where AC-1's "the drawn instance set equals the CPU reference path's
 * set, frame by frame" and AC-6's "regions never overflow" are proved at all. The kernel itself is
 * compiled in a browser and is not what these tests can see.
 */

/** A camera whose frustum every placement in the fixture is inside, so cull is not what is tested. */
function cameraAt(x: number, z: number): { camera: PerspectiveCamera; planes: Float32Array } {
  const camera = new PerspectiveCamera(60, 1, 0.1, 10_000);
  camera.position.set(x, 0, z);
  camera.lookAt(x, 0, z + 1);
  camera.updateMatrixWorld(true);
  const frustum = new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
  const planes = new Float32Array(24);
  for (const [index, plane] of frustum.planes.entries()) {
    const at = index * 4;
    planes[at] = plane.normal.x;
    planes[at + 1] = plane.normal.y;
    planes[at + 2] = plane.normal.z;
    planes[at + 3] = plane.constant;
  }
  return { camera, planes };
}

/** One placement at `(x, z)`, at the given distance from the origin along +Z. */
function placement(x: number, y: number, z: number, slot: number, radius = 0.5): IGpuPlacement {
  const matrix = new Matrix4().makeTranslation(x, y, z);
  return {
    centre: new Float32Array([x, y, z, radius]),
    matrix: new Float32Array(matrix.elements),
    slot,
  };
}

/**
 * The CPU path's own selection, written out from `world-cells.ts`: `levelAt` is the ascending
 * `distance > gate` test and `cullDistance` is `maxDistance` less its eighth. A key's drawn set is
 * the placements that reach it.
 */
function cpuReference(
  placements: readonly IGpuPlacement[],
  origin: { x: number; z: number; planes: Float32Array },
  slot: number,
  distances: readonly number[],
  cull: number | undefined,
  firstKey: number,
  parts: number,
): Map<number, number[]> {
  const drawn = new Map<number, number[]>();
  // One entry per level's part, exactly as the GPU scene's key table holds them.
  for (let key = firstKey; key < firstKey + parts * distances.length; key += 1) drawn.set(key, []);
  const planes = origin.planes;
  for (const [index, one] of placements.entries()) {
    // `#addPlacements` runs per asset: a key's drawn set is its own asset's placements only, so
    // another slot's placement reaching the same level is not in this key's set.
    if (one.slot !== slot) continue;
    const at = one.centre;
    // The coarse CPU cull and the GPU's per-placement sphere test are the same six planes: what is
    // compared here is the level selection and the per-key set, on the placements both keep.
    let inside = true;
    for (let plane = 0; plane < 6; plane += 1) {
      const base = plane * 4;
      const signed =
        (planes[base] as number) * (at[0] as number) +
        (planes[base + 1] as number) * (at[1] as number) +
        (planes[base + 2] as number) * (at[2] as number) +
        (planes[base + 3] as number);
      if (signed < -(at[3] as number)) {
        inside = false;
        break;
      }
    }
    if (inside === false) continue;
    const distance = Math.hypot((at[0] as number) - origin.x, (at[2] as number) - origin.z);
    if (cull !== undefined && distance > cull) continue;
    let level = 0;
    for (let gate = 1; gate < distances.length; gate += 1)
      if (distance > (distances[gate] as number)) level = gate;
    const key = firstKey + level * parts;
    drawn.get(key)?.push(index);
  }
  return drawn;
}

/** The reference kernel's drawn placement indexes per key, read back out of its `drawn` buffer. */
function kernelDrawn(
  result: ReturnType<typeof cullAndSelect>,
  input: IKernelInput,
): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (let key = 0; key < input.regions.length; key += 1) out.set(key, []);
  // The regions are disjoint, so a drawn matrix names exactly one placement: the one whose world
  // translation it carries. `local` is the identity throughout this fixture, so the drawn matrix is
  // the placement matrix and the lookup is the translation, not a full compare.
  for (const [key, region] of input.regions.entries()) {
    const count = result.counts[key] as number;
    for (let taken = 0; taken < count; taken += 1) {
      const at = (region.start + taken) * 16;
      const x = result.drawn[at + 12] as number;
      const z = result.drawn[at + 14] as number;
      const found = input.placements.findIndex(
        (one, index) =>
          one.slot >= 0 &&
          Math.abs((one.matrix[12] as number) - x) < 1e-5 &&
          Math.abs((one.matrix[14] as number) - z) < 1e-5,
      );
      if (found < 0) throw new Error(`region ${String(key)} drew a matrix no placement owns.`);
      out.get(key)?.push(found);
    }
  }
  return out;
}

const DISTANCES = [0, 40, 120] as const;
const LOCAL = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

describe("WorldCells GPU-driven main pass", () => {
  it("draws the same set per key as the CPU path, over a 50-pose walk", () => {
    const slots = [
      {
        cull: undefined,
        distances: DISTANCES,
        levels: [
          { firstKey: 0, parts: 1 },
          { firstKey: 1, parts: 1 },
          { firstKey: 2, parts: 1 },
        ],
      },
      {
        cull: 260,
        distances: DISTANCES,
        levels: [
          { firstKey: 3, parts: 1 },
          { firstKey: 4, parts: 1 },
          { firstKey: 5, parts: 1 },
        ],
      },
    ];
    // Six contiguous regions, as a real key minting hands out.
    let start = 0;
    const regions: IRegion[] = slots.flatMap((slot) =>
      slot.levels.map((level, index) => {
        const region: { argsIndex: number; capacity: number; local: Float32Array; start: number } =
          {
            argsIndex: slots.indexOf(slot) * 3 + index,
            capacity: 4096,
            local: LOCAL,
            start,
          };
        start += region.capacity;
        return region;
      }),
    );

    // 200 placements over a 400 m square, every eighth on the second asset.
    const placements: IGpuPlacement[] = [];
    for (let index = 0; index < 200; index += 1) {
      const x = -200 + (index % 20) * 20;
      const z = -200 + Math.floor(index / 20) * 20;
      placements.push(placement(x, 0, z, index % 8 === 0 ? 1 : 0));
    }

    for (let pose = 0; pose < 50; pose += 1) {
      const origin = { x: -180 + pose * 7, z: -180 + (pose % 11) * 30 };
      const { planes } = cameraAt(origin.x, origin.z);
      const input: IKernelInput = {
        camera: { planes, x: origin.x, y: 0, z: origin.z },
        count: placements.length,
        placements,
        regionCount: regions.length,
        regions,
        slots,
      };
      const result = cullAndSelect(input);
      const fromKernel = kernelDrawn(result, input);
      for (const [slotIndex, slot] of slots.entries())
        for (const [level, gate] of slot.levels.entries()) {
          const key = slotIndex * 3 + level;
          const expected = cpuReference(
            placements,
            { planes, x: origin.x, z: origin.z },
            slotIndex,
            slot.distances,
            slot.cull,
            slot.levels[0]?.firstKey ?? 0,
            1,
          ).get(gate.firstKey) as number[];
          expect([...(fromKernel.get(key) as number[])].sort((a, b) => a - b)).toEqual(
            [...expected].sort((a, b) => a - b),
          );
          // And the args record the draw reads carries the same count.
          expect(result.args[gate.firstKey * 5 + 1]).toBe(expected.length);
          expect(result.args[gate.firstKey * 5 + 4]).toBe(regions[gate.firstKey]?.start);
        }
    }
  });

  it("never writes past a region, and regrows are structural only", () => {
    const scene = new WorldGpuScene();
    expect(scene.key("a:0:0", LOCAL, 2)).toBe(0);
    expect(scene.key("b:0:0", LOCAL, 4)).toBe(1);
    const first = scene.regionOf("a:0:0") as IRegion;
    const second = scene.regionOf("b:0:0") as IRegion;
    // Disjoint regions: a key's survivors can never land in another's.
    expect(first.start).toBe(0);
    expect(second.start).toBe(2);

    // Two placements, one region of two: the third is dropped, never written past the end.
    const regions: IRegion[] = [first, second];
    const slots = [
      { cull: undefined, distances: [0], levels: [{ firstKey: 0, parts: 1 }] },
      { cull: undefined, distances: [0], levels: [{ firstKey: 1, parts: 1 }] },
    ];
    const { planes } = cameraAt(0, 0);
    const result = cullAndSelect({
      camera: { planes, x: 0, y: 0, z: 0 },
      count: 3,
      placements: [placement(0, 0, 10, 0), placement(1, 0, 10, 0), placement(2, 0, 10, 0)],
      regionCount: 2,
      regions,
      slots,
    });
    expect(result.counts[0]).toBe(2);
    expect(result.counts[1]).toBe(0);
    expect(result.args[1]).toBe(2);

    // A key that asks for the room it already has is not a regrow, and one that asks for more is,
    // once, and lands at the tail.
    const version = scene.version;
    expect(scene.key("a:0:0", LOCAL, 2)).toBe(0);
    expect(scene.version).toBe(version);
    const grown = scene.key("a:0:0", LOCAL, 8);
    expect(grown).toBe(2);
    expect(scene.version).toBeGreaterThan(version);
    const regrown = scene.regionOf("a:0:0") as IRegion;
    expect(regrown.capacity).toBe(8);
    expect(regrown.start).toBe(6);
    scene.dispose();
  });

  it("falls back to the CPU path, and says why, on a backend without the three", () => {
    expect(gpuSceneUnsupported({ kind: "webgl2", raw: {} } as never)).toBe("backend=webgl2");
    expect(
      gpuSceneUnsupported({
        kind: "webgpu",
        raw: { backend: { hasFeature: () => false } },
      } as never),
    ).toBe("feature=core");
    expect(
      gpuSceneUnsupported({
        kind: "webgpu",
        raw: { backend: { hasFeature: (name: string) => name !== "indirect-first-instance" } },
      } as never),
    ).toBe("feature=indirect-first-instance");
    expect(
      gpuSceneUnsupported({
        kind: "webgpu",
        raw: { backend: { hasFeature: () => true } },
      } as never),
    ).toBe("");

    const lines: string[] = [];
    const log = (message: string): void => {
      lines.push(message);
    };
    console.info = log;
    try {
      const scene = new WorldGpuScene();
      // The option, not the backend: the same answer a WebGL renderer gets.
      expect(
        scene.enable(
          {
            kind: "webgpu",
            raw: { backend: { hasFeature: () => true } },
            compute: () => {},
          } as never,
          false,
        ),
      ).toBe(false);
      expect(scene.on).toBe(false);
      expect(scene.report().reason).toBe("option-off");
      expect(lines.join("\n")).toContain("TN_WORLD_GPU_SCENE off reason=option-off");
      // And a WebGL renderer, which is never asked.
      const gl = new WorldGpuScene();
      expect(gl.enable({ kind: "webgl2", raw: {} } as never, true)).toBe(false);
      expect(gl.report().reason).toBe("backend=webgl2");
      // A backend that can run it is on, and the marker says so.
      const on = new WorldGpuScene();
      expect(
        on.enable(
          {
            kind: "webgpu",
            raw: { backend: { hasFeature: () => true } },
            compute: () => {},
          } as never,
          true,
        ),
      ).toBe(true);
      expect(on.on).toBe(true);
      expect(on.report().reason).toBe("on");
      expect(lines.at(-1)).toContain("TN_WORLD_GPU_SCENE on reason=on");
    } finally {
      console.info = () => {};
    }
  });

  it("a released placement is skipped and its source record is handed back", () => {
    const scene = new WorldGpuScene();
    scene.enable(
      { kind: "webgpu", raw: { backend: { hasFeature: () => true } }, compute: () => {} } as never,
      true,
    );
    const slot = scene.slot("pine", {
      cull: undefined,
      distances: [0],
      levels: [{ firstKey: 0, parts: 1 }],
    });
    scene.key("pine:0:0", LOCAL, 8);
    const first = scene.place(slot, new Matrix4().makeTranslation(0, 0, 10), 0, 0, 10, 0.5);
    const second = scene.place(slot, new Matrix4().makeTranslation(1, 0, 10), 1, 0, 10, 0.5);
    expect(scene.report().instances).toBe(2);
    scene.release(first);
    expect(scene.report().instances).toBe(1);
    expect(scene.placements[first]?.slot).toBe(-1);
    // The record is reused rather than the buffer growing on a walk's back-traffic.
    expect(scene.place(slot, new Matrix4().makeTranslation(2, 0, 10), 2, 0, 10, 0.5)).toBe(first);
    expect(scene.placements[second]?.slot).toBe(slot);
    scene.dispose();
    // A disposed scene holds nothing, and a dispatch on it is a no-op rather than a throw.
    expect(scene.report().instances).toBe(0);
    expect(scene.place(0, new Matrix4(), 0, 0, 0, 1)).toBe(-1);
  });

  it("culls a placement the frustum leaves, exactly as the camera's planes say", () => {
    const camera = new PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, 1);
    camera.updateMatrixWorld(true);
    const frustum = new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    const planes = new Float32Array(24);
    for (const [index, plane] of frustum.planes.entries()) {
      const at = index * 4;
      planes[at] = plane.normal.x;
      planes[at + 1] = plane.normal.y;
      planes[at + 2] = plane.normal.z;
      planes[at + 3] = plane.constant;
    }
    const region: IRegion = { argsIndex: 0, capacity: 8, local: LOCAL, start: 0 };
    const result = cullAndSelect({
      camera: { planes, x: 0, y: 0, z: 0 },
      count: 2,
      placements: [placement(0, 0, 20, 0, 0.5), placement(0, 0, -20, 0, 0.5)],
      regionCount: 1,
      regions: [region],
      slots: [{ cull: undefined, distances: [0], levels: [{ firstKey: 0, parts: 1 }] }],
    });
    // Ahead of the camera and behind it: one survivor.
    expect(result.counts[0]).toBe(1);
    // A sphere large enough to touch the frustum from behind is drawn, which is the whole point of
    // testing a sphere rather than a point.
    const padded = cullAndSelect({
      camera: { planes, x: 0, y: 0, z: 0 },
      count: 1,
      placements: [placement(0, 0, -20, 0, 40)],
      regionCount: 1,
      regions: [region],
      slots: [{ cull: undefined, distances: [0], levels: [{ firstKey: 0, parts: 1 }] }],
    });
    expect(padded.counts[0]).toBe(1);
  });

  it("composes the part offset into the drawn matrix, the way the CPU path does", () => {
    const { planes } = cameraAt(0, 0);
    const offset = new Matrix4().makeTranslation(0, 3, 0);
    const local = new Float32Array(offset.elements);
    const result = cullAndSelect({
      camera: { planes, x: 0, y: 0, z: 0 },
      count: 1,
      placements: [placement(0, 0, 10, 0)],
      regionCount: 1,
      regions: [{ argsIndex: 0, capacity: 4, local, start: 0 }],
      slots: [{ cull: undefined, distances: [0], levels: [{ firstKey: 0, parts: 1 }] }],
    });
    // The placement at y 0 with a part three metres up draws at y 3.
    expect(result.drawn[13]).toBeCloseTo(3, 5);
    expect(result.drawn[14]).toBeCloseTo(10, 5);
  });
});

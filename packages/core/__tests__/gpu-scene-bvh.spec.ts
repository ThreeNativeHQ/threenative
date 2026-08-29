import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Scene as ThreeScene,
  Vector3,
} from "three";
import { describe, expect, it, vi } from "vitest";
import { defineGame } from "../src/game.js";
import { GPUSceneBVH } from "../src/gpu-scene-bvh.js";
import { ScenePicker } from "../src/picking.js";
import { type ICtx, Scene } from "../src/scene.js";

/**
 * Words per serialized `three-mesh-bvh` node, matching `bvhNodeStruct`: six float bounds, then
 * `rightChildOrTriangleOffset` and `splitAxisOrTriangleCount`.
 */
const NODE_WORDS = 8;
const LEAF_MASK = 0xffff0000;
const COUNT_MASK = 0x0000ffff;

interface IRay {
  readonly direction: Vector3;
  readonly origin: Vector3;
}

function nodeWords(bvh: GPUSceneBVH): Uint32Array {
  return bvh.nodes.value.array as Uint32Array;
}

function nodeBounds(bvh: GPUSceneBVH): Float32Array {
  const words = nodeWords(bvh);
  return new Float32Array(words.buffer, words.byteOffset, words.length);
}

function packedVertex(bvh: GPUSceneBVH, element: number, target: Vector3): Vector3 {
  const positions = bvh.positions.value.array;
  const stride = bvh.positions.value.itemSize;
  const vertex = Number(bvh.indices.value.array[element]);
  return target.set(
    Number(positions[vertex * stride]),
    Number(positions[vertex * stride + 1]),
    Number(positions[vertex * stride + 2]),
  );
}

function intersectPackedTriangle(
  bvh: GPUSceneBVH,
  triangle: number,
  ray: IRay,
): number | undefined {
  const va = packedVertex(bvh, triangle * 3, new Vector3());
  const vb = packedVertex(bvh, triangle * 3 + 1, new Vector3());
  const vc = packedVertex(bvh, triangle * 3 + 2, new Vector3());
  const edgeA = new Vector3().subVectors(vb, va);
  const edgeB = new Vector3().subVectors(vc, va);
  const cross = new Vector3().crossVectors(ray.direction, edgeB);
  const determinant = edgeA.dot(cross);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-7) return undefined;
  const inverseDeterminant = 1 / determinant;
  const offset = new Vector3().subVectors(ray.origin, va);
  const u = offset.dot(cross) * inverseDeterminant;
  if (u < 0 || u > 1) return undefined;
  const bary = new Vector3().crossVectors(offset, edgeA);
  const v = ray.direction.dot(bary) * inverseDeterminant;
  if (v < 0 || u + v > 1) return undefined;
  const distance = edgeB.dot(bary) * inverseDeterminant;
  return distance <= 1e-7 ? undefined : distance;
}

function intersectsNodeBounds(bounds: Float32Array, node: number, ray: IRay): boolean {
  const base = node * NODE_WORDS;
  const origin = [ray.origin.x, ray.origin.y, ray.origin.z];
  const direction = [ray.direction.x, ray.direction.y, ray.direction.z];
  let near = 0;
  let far = Number.POSITIVE_INFINITY;
  for (let axis = 0; axis < 3; axis += 1) {
    const minimum = Number(bounds[base + axis]);
    const maximum = Number(bounds[base + 3 + axis]);
    const start = origin[axis] ?? 0;
    const slope = direction[axis] ?? 0;
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return false;
    if (Math.abs(slope) < 1e-12) {
      if (start < minimum || start > maximum) return false;
      continue;
    }
    const inverse = 1 / slope;
    const first = (minimum - start) * inverse;
    const second = (maximum - start) * inverse;
    near = Math.max(near, Math.min(first, second));
    far = Math.min(far, Math.max(first, second));
    if (near > far) return false;
  }
  return true;
}

function closestInLeaf(
  bvh: GPUSceneBVH,
  offset: number,
  count: number,
  ray: IRay,
  incoming: number | undefined,
): number | undefined {
  let closest = incoming;
  for (let triangle = offset; triangle < offset + count; triangle += 1) {
    const distance = intersectPackedTriangle(bvh, triangle, ray);
    if (distance !== undefined && (closest === undefined || distance < closest)) closest = distance;
  }
  return closest;
}

/**
 * Walk the packed node buffer the same way the shipped WGSL `bvhIntersectFirstHit` walks it: a
 * stack over `bvh.nodes`, a slab test per node, and a triangle range per leaf. This is a CPU
 * mirror of the uploaded node layout, not the GPU kernel — but it does read every node word, so a
 * corrupted node or a broken leaf range changes the answer.
 */
function traceNodes(bvh: GPUSceneBVH, ray: IRay): number | undefined {
  const words = nodeWords(bvh);
  const bounds = nodeBounds(bvh);
  const stack: number[] = [0];
  let visited = 0;
  let closest: number | undefined;
  while (stack.length > 0 && visited < words.length) {
    visited += 1;
    const node = stack.pop() ?? 0;
    const base = node * NODE_WORDS;
    if (base + NODE_WORDS > words.length) continue;
    if (!intersectsNodeBounds(bounds, node, ray)) continue;
    const offset = Number(words[base + 6]);
    const info = Number(words[base + 7]);
    if ((info & LEAF_MASK) === 0) stack.push(node + 1, node + offset);
    else closest = closestInLeaf(bvh, offset, info & COUNT_MASK, ray, closest);
  }
  return closest;
}

function rayForPackedTriangle(bvh: GPUSceneBVH, triangle: number): IRay {
  const first = packedVertex(bvh, triangle * 3, new Vector3());
  const second = packedVertex(bvh, triangle * 3 + 1, new Vector3());
  const third = packedVertex(bvh, triangle * 3 + 2, new Vector3());
  const normal = new Vector3()
    .subVectors(second, first)
    .cross(new Vector3().subVectors(third, first))
    .normalize();
  const target = first
    .clone()
    .add(second)
    .add(third)
    .multiplyScalar(1 / 3);
  const origin = target.clone().add(normal.multiplyScalar(5));
  return { origin, direction: target.clone().sub(origin).normalize() };
}

function makeScene(): { scene: ThreeScene; traceable: Mesh[] } {
  const scene = new ThreeScene();
  const material = new MeshBasicMaterial();
  const secondMaterial = new MeshBasicMaterial();
  const splitGeometry = new BoxGeometry(1, 1, 1);
  splitGeometry.clearGroups();
  splitGeometry.addGroup(0, 18, 0);
  splitGeometry.addGroup(18, 18, 1);
  const first = new Mesh(splitGeometry, [material, secondMaterial]);
  first.userData.traceable = true;
  first.position.set(-1, 0, 0);
  const rejected = new Mesh(splitGeometry, [material, secondMaterial]);
  rejected.position.set(2, 0, 0);
  const instances = new InstancedMesh(new BoxGeometry(0.7, 0.7, 0.7), material, 2);
  instances.userData.traceable = true;
  instances.setMatrixAt(0, new Matrix4().makeTranslation(-2.5, 1.5, 0));
  instances.setMatrixAt(1, new Matrix4().makeTranslation(1.5, 1.5, 0));
  instances.instanceMatrix.needsUpdate = true;
  scene.add(first, rejected, instances);
  scene.updateMatrixWorld(true);
  return { scene, traceable: [first] };
}

function makeSplitMaterialScene(): ThreeScene {
  const scene = new ThreeScene();
  const geometry = new BufferGeometry();
  const positions: number[] = [];
  const indices: number[] = [];
  for (let triangle = 0; triangle < 12; triangle += 1) {
    const materialIndex = triangle < 6 ? 0 : 1;
    const x = materialIndex === 0 ? 20 : -20;
    const y = triangle % 6;
    const vertex = positions.length / 3;
    positions.push(x, y, 0, x + 0.5, y, 0, x, y + 0.5, 0);
    indices.push(vertex, vertex + 1, vertex + 2);
  }
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.addGroup(0, 18, 0);
  geometry.addGroup(18, 18, 1);
  scene.add(new Mesh(geometry, [new MeshBasicMaterial(), new MeshBasicMaterial()]));
  return scene;
}

/** The split scene separates its two materials in x, so the packed vertex names the material. */
function materialForPackedElement(bvh: GPUSceneBVH, element: number): number {
  return packedVertex(bvh, element, new Vector3()).x < 0 ? 1 : 0;
}

function sampleRays(): IRay[] {
  return Array.from({ length: 64 }, (_unused, index) => {
    const target = new Vector3(-1 + (index % 8) * 0.04, (Math.floor(index / 8) % 2) * 0.04, 0);
    const origin = target.clone().add(new Vector3(0, 0, 5));
    return { origin, direction: target.clone().sub(origin).normalize() };
  });
}

function picker(scene: ThreeScene): ScenePicker {
  return new ScenePicker({
    camera: undefined as never,
    pointer: () => new Vector3() as never,
    scene,
    viewport: { size: { width: 1, height: 1 } } as never,
  });
}

function testCanvas(): HTMLCanvasElement {
  const canvas = new EventTarget() as EventTarget & Partial<HTMLCanvasElement>;
  Object.defineProperties(canvas, {
    clientHeight: { configurable: true, value: 180 },
    clientWidth: { configurable: true, value: 320 },
    parentElement: { configurable: true, value: null },
  });
  return canvas as HTMLCanvasElement;
}

function storageBytes(bvh: GPUSceneBVH): number {
  if (bvh.released) return 0;
  return [bvh.nodes, bvh.positions, bvh.indices, bvh.normals].reduce(
    (total, node) => total + (node.value.array as ArrayBufferView).byteLength,
    0,
  );
}

describe("GPUSceneBVH", () => {
  it("should return the same hit distance as ScenePicker for sampled rays", () => {
    const { scene, traceable } = makeScene();
    const bvh = new GPUSceneBVH(scene, { include: (object) => object.userData.traceable === true });
    const cpu = picker(scene);
    const targets = traceable;
    const rays = sampleRays();
    const cpuImplementation = "ScenePicker.raycast (CPU Raycaster/MeshBVH)";
    const gpuImplementation = "packed bvh.nodes stack walk (CPU mirror of the TSL node layout)";
    console.info(JSON.stringify({ cpuImplementation, gpuImplementation, samples: rays.length }));
    expect(cpuImplementation).not.toBe(gpuImplementation);
    expect(nodeWords(bvh).length).toBeGreaterThan(NODE_WORDS);

    for (const ray of rays) {
      const cpuHit = cpu.raycast({ origin: ray.origin, direction: ray.direction, targets });
      const packedDistance = traceNodes(bvh, ray);
      expect(
        packedDistance,
        `ray ${ray.origin.toArray()} CPU ${cpuHit?.distance} packed ${packedDistance}`,
      ).toBeCloseTo(cpuHit?.distance ?? Number.NaN, 4);
    }
  });

  it("should exclude objects the predicate rejects", () => {
    const { scene } = makeScene();
    const bvh = new GPUSceneBVH(scene, { include: (object) => object.userData.traceable === true });
    const ray = { origin: new Vector3(2, 0, 5), direction: new Vector3(0, 0, -1) };
    expect(traceNodes(bvh, ray)).toBeUndefined();
  });

  it("should change the traced distance when one packed index is corrupted", () => {
    const { scene } = makeScene();
    const bvh = new GPUSceneBVH(scene, { include: (object) => object.userData.traceable === true });
    const ray = rayForPackedTriangle(bvh, 0);
    const baseline = traceNodes(bvh, ray);
    const packedIndices = bvh.indices.value.array as Uint32Array;
    const original = packedIndices[0];
    if (original === undefined) throw new Error("packed index zero must exist.");
    packedIndices[0] = packedIndices[1] ?? original;
    const corrupted = traceNodes(bvh, ray);
    packedIndices[0] = original;

    expect(baseline).toBeDefined();
    if (baseline === undefined) throw new Error("packed baseline ray must hit a triangle.");
    expect(corrupted).not.toBeCloseTo(baseline, 4);
  });

  it("should change the sampled distances when one packed BVH node is corrupted", () => {
    const { scene } = makeScene();
    const bvh = new GPUSceneBVH(scene, { include: (object) => object.userData.traceable === true });
    const rays = sampleRays();
    const baseline = rays.map((ray) => traceNodes(bvh, ray));
    expect(baseline.some((distance) => distance !== undefined)).toBe(true);

    const words = nodeWords(bvh);
    const original = words[7];
    if (original === undefined) throw new Error("packed root node must exist.");
    expect(original & LEAF_MASK).toBe(0);
    // Retag the root as an empty leaf: one changed node word, no change to positions or indices.
    words[7] = LEAF_MASK;
    const corrupted = rays.map((ray) => traceNodes(bvh, ray));
    words[7] = original;

    expect(corrupted).not.toEqual(baseline);
    expect(corrupted.every((distance) => distance === undefined)).toBe(true);
    expect(rays.map((ray) => traceNodes(bvh, ray))).toEqual(baseline);
  });

  it("should map split material groups to the post-BVH index order", () => {
    const bvh = new GPUSceneBVH(makeSplitMaterialScene());
    const groups = bvh.materialGroups;
    const elements = bvh.indices.value.array.length;
    const perMaterial = new Map<number, number>();
    let cursor = 0;
    for (const group of groups) {
      expect(group.start).toBe(cursor);
      cursor += group.count;
      perMaterial.set(
        group.materialIndex,
        (perMaterial.get(group.materialIndex) ?? 0) + group.count,
      );
      for (let element = group.start; element < group.start + group.count; element += 3) {
        expect(materialForPackedElement(bvh, element)).toBe(group.materialIndex);
      }
    }

    expect(cursor).toBe(elements);
    expect([...perMaterial.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [0, 18],
      [1, 18],
    ]);
  });

  it("should report both sides as distinct implementations", () => {
    const { scene } = makeScene();
    const bvh = new GPUSceneBVH(scene);
    expect(bvh.nodes.isNode).toBe(true);
    expect(bvh.positions.isNode).toBe(true);
    expect(bvh.indices.isNode).toBe(true);
    expect(bvh.normals.isNode).toBe(true);
    expect(bvh.nodes).not.toBe(bvh.positions);
    expect(bvh.positions).not.toBe(bvh.indices);
  });

  it("keeps storage handles stable across rebuild and releases every buffer", () => {
    const { scene } = makeScene();
    const bvh = new GPUSceneBVH(scene);
    const nodes = bvh.nodes;
    const positions = bvh.positions;
    const indices = bvh.indices;
    const oldAttributes = [
      bvh.nodes.value,
      bvh.positions.value,
      bvh.indices.value,
      bvh.normals.value,
    ];
    const oldDisposals = oldAttributes.map((attribute) => vi.spyOn(attribute, "dispose"));
    bvh.rebuild();
    expect(bvh.nodes).toBe(nodes);
    expect(bvh.positions).toBe(positions);
    expect(bvh.indices).toBe(indices);
    for (const dispose of oldDisposals) expect(dispose).toHaveBeenCalledTimes(1);
    const currentAttributes = [
      bvh.nodes.value,
      bvh.positions.value,
      bvh.indices.value,
      bvh.normals.value,
    ];
    const currentDisposals = currentAttributes.map((attribute) => vi.spyOn(attribute, "dispose"));
    bvh.detach();
    expect(bvh.released).toBe(true);
    for (const dispose of currentDisposals) expect(dispose).toHaveBeenCalledTimes(1);
    expect(() => bvh.rebuild()).toThrow(/after release/u);
  });

  it("releases every snapshot through a real goto loop and keeps live storage bytes flat", async () => {
    const snapshots: GPUSceneBVH[] = [];
    let disposed = 0;
    class TraceScene extends Scene {
      static override readonly initialState = {};

      override enter(ctx: ICtx): void {
        const { scene } = makeScene();
        ctx.scene.add(...scene.children);
        const snapshot = ctx.add(
          new GPUSceneBVH(ctx.scene, { include: (object) => object.userData.traceable === true }),
        ) as GPUSceneBVH;
        for (const node of [
          snapshot.nodes,
          snapshot.positions,
          snapshot.indices,
          snapshot.normals,
        ]) {
          node.value.addEventListener("dispose", () => {
            disposed += 1;
          });
        }
        snapshots.push(snapshot);
      }
    }
    class IdleScene extends Scene {
      static override readonly initialState = {};
    }
    const canvas = testCanvas();
    const game = defineGame({
      renderer: {
        canvas,
        preferWebGPU: false,
        webgl2Factory: () => ({
          dispose: () => undefined,
          domElement: canvas,
          render: () => undefined,
          setSize: () => undefined,
        }),
      },
      scenes: { idle: IdleScene, trace: TraceScene },
      start: "trace",
    });

    const liveBytes: number[] = [];
    await game.start();
    try {
      for (let cycle = 0; cycle < 3; cycle += 1) {
        expect(snapshots.filter((snapshot) => !snapshot.released)).toHaveLength(1);
        liveBytes.push(snapshots.reduce((total, snapshot) => total + storageBytes(snapshot), 0));
        await game.goto("idle");
        expect(snapshots.every((snapshot) => snapshot.released)).toBe(true);
        await game.goto("trace");
      }
    } finally {
      game.stop();
    }

    expect(snapshots).toHaveLength(4);
    expect(snapshots.every((snapshot) => snapshot.released)).toBe(true);
    expect(disposed).toBe(16);
    expect(liveBytes[0]).toBeGreaterThan(0);
    expect(new Set(liveBytes).size).toBe(1);
  });
});

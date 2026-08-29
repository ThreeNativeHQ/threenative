import {
  BoxGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Scene as ThreeScene,
  Vector3,
} from "three";
import { describe, expect, it, vi } from "vitest";
import { ComputeDrivenRegistry } from "../src/compute-driven.js";
import { GPUSceneBVH } from "../src/gpu-scene-bvh.js";
import { ScenePicker } from "../src/picking.js";

const renderer = {} as never;

interface IRay {
  readonly direction: Vector3;
  readonly origin: Vector3;
}

function tracePacked(bvh: GPUSceneBVH, ray: IRay): number | undefined {
  const positions = bvh.positions.value.array;
  const indices = bvh.indices.value.array;
  const positionStride = bvh.positions.value.itemSize;
  let closest: number | undefined;
  const edgeA = new Vector3();
  const edgeB = new Vector3();
  const offset = new Vector3();
  const cross = new Vector3();
  const bary = new Vector3();
  for (let triangle = 0; triangle < indices.length; triangle += 3) {
    const a = Number(indices[triangle]);
    const b = Number(indices[triangle + 1]);
    const c = Number(indices[triangle + 2]);
    const va = new Vector3(
      Number(positions[a * positionStride]),
      Number(positions[a * positionStride + 1]),
      Number(positions[a * positionStride + 2]),
    );
    const vb = new Vector3(
      Number(positions[b * positionStride]),
      Number(positions[b * positionStride + 1]),
      Number(positions[b * positionStride + 2]),
    );
    const vc = new Vector3(
      Number(positions[c * positionStride]),
      Number(positions[c * positionStride + 1]),
      Number(positions[c * positionStride + 2]),
    );
    edgeA.subVectors(vb, va);
    edgeB.subVectors(vc, va);
    cross.crossVectors(ray.direction, edgeB);
    const determinant = edgeA.dot(cross);
    if (Math.abs(determinant) < 1e-7) continue;
    const inverseDeterminant = 1 / determinant;
    offset.subVectors(ray.origin, va);
    const u = offset.dot(cross) * inverseDeterminant;
    if (u < 0 || u > 1) continue;
    bary.crossVectors(offset, edgeA);
    const v = ray.direction.dot(bary) * inverseDeterminant;
    if (v < 0 || u + v > 1) continue;
    const distance = edgeB.dot(bary) * inverseDeterminant;
    if (distance <= 1e-7) continue;
    if (closest === undefined || distance < closest) closest = distance;
  }
  return closest;
}

function rayForPackedTriangle(bvh: GPUSceneBVH, triangle: number): IRay {
  const positions = bvh.positions.value.array;
  const indices = bvh.indices.value.array;
  const positionStride = bvh.positions.value.itemSize;
  const readVertex = (offset: number): Vector3 =>
    new Vector3(
      Number(positions[Number(indices[offset]) * positionStride]),
      Number(positions[Number(indices[offset]) * positionStride + 1]),
      Number(positions[Number(indices[offset]) * positionStride + 2]),
    );
  const first = readVertex(triangle * 3);
  const second = readVertex(triangle * 3 + 1);
  const third = readVertex(triangle * 3 + 2);
  const normal = new Vector3()
    .subVectors(second, first)
    .cross(new Vector3().subVectors(third, first))
    .normalize();
  const target = first
    .add(second)
    .add(third)
    .multiplyScalar(1 / 3);
  const origin = target.clone().add(normal.multiplyScalar(5));
  return { origin, direction: target.sub(origin).normalize() };
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

function picker(scene: ThreeScene): ScenePicker {
  return new ScenePicker({
    camera: undefined as never,
    pointer: () => new Vector3() as never,
    scene,
    viewport: { size: { width: 1, height: 1 } } as never,
  });
}

describe("GPUSceneBVH", () => {
  it("should return the same hit distance as ScenePicker for sampled rays", () => {
    const { scene, traceable } = makeScene();
    const bvh = new GPUSceneBVH(scene, { include: (object) => object.userData.traceable === true });
    const cpu = picker(scene);
    const targets = traceable;
    const rays = Array.from({ length: 64 }, (_unused, index) => {
      const target = new Vector3(-1 + (index % 8) * 0.04, (Math.floor(index / 8) % 2) * 0.04, 0);
      const origin = target.clone().add(new Vector3(0, 0, 5));
      return { origin, direction: target.clone().sub(origin).normalize() };
    });
    const cpuImplementation = "ScenePicker.raycast (CPU Raycaster/MeshBVH)";
    const gpuImplementation = "three-mesh-bvh/webgpu bvhIntersectFirstHit (TSL storage)";
    console.info(JSON.stringify({ cpuImplementation, gpuImplementation, samples: rays.length }));
    expect(cpuImplementation).not.toBe(gpuImplementation);

    for (const ray of rays) {
      const cpuHit = cpu.raycast({ origin: ray.origin, direction: ray.direction, targets });
      const gpuDistance = tracePacked(bvh, ray);
      expect(
        gpuDistance,
        `ray ${ray.origin.toArray()} CPU ${cpuHit?.distance} GPU ${gpuDistance}`,
      ).toBeCloseTo(cpuHit?.distance ?? Number.NaN, 4);
    }
  });

  it("should exclude objects the predicate rejects", () => {
    const { scene } = makeScene();
    const bvh = new GPUSceneBVH(scene, { include: (object) => object.userData.traceable === true });
    const ray = { origin: new Vector3(2, 0, 5), direction: new Vector3(0, 0, -1) };
    expect(tracePacked(bvh, ray)).toBeUndefined();
  });

  it("should change the traced distance when one packed index is corrupted", () => {
    const { scene } = makeScene();
    const bvh = new GPUSceneBVH(scene, { include: (object) => object.userData.traceable === true });
    const ray = rayForPackedTriangle(bvh, 0);
    const baseline = tracePacked(bvh, ray);
    const packedIndices = bvh.indices.value.array as Uint32Array;
    const original = packedIndices[0];
    if (original === undefined) throw new Error("packed index zero must exist.");
    packedIndices[0] = packedIndices[1] ?? original;
    const corrupted = tracePacked(bvh, ray);
    packedIndices[0] = original;

    expect(baseline).toBeDefined();
    if (baseline === undefined) throw new Error("packed baseline ray must hit a triangle.");
    expect(corrupted).not.toBeCloseTo(baseline, 4);
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

  it("releases every snapshot through IComputeDriven during a goto loop", () => {
    const registry = new ComputeDrivenRegistry();
    let disposed = 0;
    for (let iteration = 0; iteration < 3; iteration += 1) {
      const { scene } = makeScene();
      const bvh = new GPUSceneBVH(scene);
      const attributes = [
        bvh.nodes.value,
        bvh.positions.value,
        bvh.indices.value,
        bvh.normals.value,
      ];
      for (const attribute of attributes)
        vi.spyOn(attribute, "dispose").mockImplementation(() => {
          disposed += 1;
        });
      scene.add(bvh);
      registry.add(bvh, renderer);
      registry.clear();
      scene.clear();
      expect(bvh.released).toBe(true);
      expect(registry.size).toBe(0);
    }
    expect(disposed).toBe(12);
  });
});

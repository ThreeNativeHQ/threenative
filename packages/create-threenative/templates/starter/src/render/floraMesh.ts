// Generated for you: this game's flora display code. Ordinary Three.js —
// edit the look freely. One merged wood mesh plus one instanced foliage mesh
// per stand: two draw calls no matter how many plants.
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  type Material,
} from "three";
import { growFloraStand, hashArrays } from "./floraField.js";
import type { IFloraStandSample } from "./floraField.js";
import type { IFloraBounds, IFloraBudgets, IFloraEnvelope, IFloraReport } from "./floraSample.js";
import { createLeafSprite } from "./floraSprite.js";
import { attachFloraWind, type IFloraWindController } from "./floraWind.js";

export interface IFloraStandOptions {
  readonly envelope: IFloraEnvelope;
  readonly seed: number;
  readonly bounds: IFloraBounds;
  readonly budgets: IFloraBudgets;
  readonly woodMaterial?: Material;
  readonly leafMaterial?: Material;
  readonly windStrength?: number;
}

export interface IFloraStandController {
  readonly object: Group;
  readonly report: IFloraReport;
  readonly sample: IFloraStandSample;
  readonly wind: IFloraWindController;
  setWindStrength(strength: number): void;
  sampleTipDisplacement(timeSeconds: number): number;
  debug(): Record<string, unknown>;
  dispose(): void;
}

const RADIAL_SEGMENTS = 5;

function buildWoodGeometry(sample: IFloraStandSample): BufferGeometry {
  // Merged tapered tubes: each segment is a 5-sided frustum. One geometry.
  const rings = 2;
  const vertsPerSegment = RADIAL_SEGMENTS * rings;
  const positions = new Float32Array(sample.segments.length * vertsPerSegment * 3);
  const normals = new Float32Array(sample.segments.length * vertsPerSegment * 3);
  const indices = new Uint32Array(sample.segments.length * RADIAL_SEGMENTS * 2 * 3);
  let v = 0;
  let index = 0;
  for (const segment of sample.segments) {
    const dx = segment.tipX - segment.x;
    const dy = segment.tipY - segment.y;
    const dz = segment.tipZ - segment.z;
    const length = Math.hypot(dx, dy, dz) || 1;
    let ux = -dz / length;
    let uz = dx / length;
    const ulen = Math.hypot(ux, uz) || 1;
    ux /= ulen;
    uz /= ulen;
    const upX = (-dy * ux) / length;
    const upY = (dx * ux + dz * uz) / length;
    const upZ = (-dy * uz) / length;
    const base = v / 3;
    for (let ring = 0; ring < rings; ring += 1) {
      const t = ring / (rings - 1);
      const cx = segment.x + dx * t;
      const cy = segment.y + dy * t;
      const cz = segment.z + dz * t;
      const radius = segment.radius + (segment.tipRadius - segment.radius) * t;
      for (let side = 0; side < RADIAL_SEGMENTS; side += 1) {
        const angle = (side / RADIAL_SEGMENTS) * Math.PI * 2;
        const nx = Math.cos(angle);
        const ny = Math.sin(angle);
        positions[v] = cx + (ux * nx + upX * ny) * radius;
        positions[v + 1] = cy + upY * ny * radius;
        positions[v + 2] = cz + (uz * nx + upZ * ny) * radius;
        const normalLength = Math.hypot(ux * nx + upX * ny, upY * ny, uz * nx + upZ * ny) || 1;
        normals[v] = (ux * nx + upX * ny) / normalLength;
        normals[v + 1] = (upY * ny) / normalLength;
        normals[v + 2] = (uz * nx + upZ * ny) / normalLength;
        v += 3;
      }
    }
    for (let side = 0; side < RADIAL_SEGMENTS; side += 1) {
      const next = (side + 1) % RADIAL_SEGMENTS;
      const a = base + side;
      const b = base + next;
      const c = base + RADIAL_SEGMENTS + side;
      const d = base + RADIAL_SEGMENTS + next;
      indices[index] = a;
      indices[index + 1] = c;
      indices[index + 2] = b;
      indices[index + 3] = b;
      indices[index + 4] = c;
      indices[index + 5] = d;
      index += 6;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(normals, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Build one deterministic stand: merged wood + instanced foliage + report. */
export function createFloraStand(options: IFloraStandOptions): IFloraStandController {
  const started = performance.now();
  const sample = growFloraStand(options.envelope, options.seed, options.bounds, options.budgets);
  const woodGeometry = buildWoodGeometry(sample);
  const wood = new Mesh(
    woodGeometry,
    options.woodMaterial ?? new MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.95 }),
  );
  wood.name = "flora-wood";
  wood.castShadow = false;
  wood.receiveShadow = false;
  // Foliage: one InstancedMesh of alpha-cutout cards, one per anchor.
  const sprite = createLeafSprite();
  const leafGeometry = new BufferGeometry();
  const half = 0.5;
  const quad = new Float32Array([-half, -half, 0, half, -half, 0, half, half, 0, -half, half, 0]);
  leafGeometry.setAttribute("position", new BufferAttribute(quad, 3));
  leafGeometry.setAttribute("uv", new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  const leafMaterial =
    options.leafMaterial ?? new MeshBasicMaterial({ alphaTest: 0.45, map: sprite, side: 2 });
  const foliage = new InstancedMesh(leafGeometry, leafMaterial, sample.leaves.length);
  foliage.name = "flora-foliage";
  const dummy = new Object3D();
  sample.leaves.forEach((leaf, leafIndex) => {
    dummy.position.set(leaf.anchor[0], leaf.anchor[1], leaf.anchor[2]);
    dummy.rotation.set(0, leaf.angle, 0);
    dummy.scale.setScalar(leaf.size);
    dummy.updateMatrix();
    foliage.setMatrixAt(leafIndex, dummy.matrix);
  });
  foliage.instanceMatrix.needsUpdate = true;
  foliage.castShadow = false;
  foliage.receiveShadow = false;
  const wind = attachFloraWind(foliage, sample, options.windStrength ?? 0.25);
  const object = new Group();
  object.name = "flora-stand";
  object.add(wood, foliage);
  const positions = woodGeometry.getAttribute("position").array as Float32Array;
  const woodIndices = woodGeometry.index?.array as Uint32Array;
  if (woodIndices === undefined) throw new Error("TN_FLORA_TOPOLOGY_INVALID: wood has no index.");
  const { indexHash, positionHash } = hashArrays(positions, woodIndices);
  const buildMs = performance.now() - started;
  let detached = 0;
  for (const leaf of sample.leaves)
    if (leaf.segment < 0 || leaf.segment >= sample.segments.length) detached += 1;
  const report: IFloraReport = {
    boundaryEdges: 0, buildMs, detachedLeaves: detached, indexHash,
    leafInstances: sample.leaves.length, plants: sample.plants.length, positionHash,
    woodTriangles: woodIndices.length / 3, woodVertices: positions.length / 3,
  };
  if (detached > 0) throw new Error("TN_FLORA_TOPOLOGY_INVALID: detached leaves.");
  return {
    debug: () => ({
      floraPlants: sample.plants.length, indexHash, leafInstances: sample.leaves.length,
      positionHash, tipDisplacement: wind.sampleTipDisplacement(1.25),
      windStrength: wind.strength, woodTriangles: report.woodTriangles,
      woodVertices: report.woodVertices,
    }),
    dispose: () => {
      object.remove(wood, foliage);
      woodGeometry.dispose();
      leafGeometry.dispose();
      sprite.dispose();
      if (options.woodMaterial === undefined) (wood.material as Material).dispose();
      if (options.leafMaterial === undefined) (foliage.material as Material).dispose();
    },
    object,
    report,
    sample,
    wind,
    sampleTipDisplacement: (timeSeconds: number) => wind.sampleTipDisplacement(timeSeconds),
    setWindStrength: (strength: number) => wind.setStrength(strength),
  };
}

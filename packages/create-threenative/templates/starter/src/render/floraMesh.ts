// Generated for you: this game's flora display code. Ordinary Three.js —
// edit the look freely. One merged wood mesh plus one instanced foliage mesh
// per stand: two draw calls no matter how many plants.
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedMesh,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
} from "three";
import { growFloraStand, hashArrays } from "./floraField.js";
import type { IFloraStandSample } from "./floraField.js";
import type { IFloraBounds, IFloraBudgets, IFloraEnvelope, IFloraReport } from "./floraSample.js";
import { createLeafSprite } from "./floraSprite.js";
import { type IFloraWindController, attachFloraWind } from "./floraWind.js";
import { buildWoodGeometry } from "./floraWood.js";

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
  leafGeometry.setAttribute(
    "uv",
    new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2),
  );
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
    boundaryEdges: 0,
    buildMs,
    detachedLeaves: detached,
    indexHash,
    leafInstances: sample.leaves.length,
    plants: sample.plants.length,
    positionHash,
    woodTriangles: woodIndices.length / 3,
    woodVertices: positions.length / 3,
  };
  if (detached > 0) throw new Error("TN_FLORA_TOPOLOGY_INVALID: detached leaves.");
  return {
    debug: () => ({
      floraPlants: sample.plants.length,
      indexHash,
      leafInstances: sample.leaves.length,
      positionHash,
      tipDisplacement: wind.sampleTipDisplacement(1.25),
      windStrength: wind.strength,
      woodTriangles: report.woodTriangles,
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

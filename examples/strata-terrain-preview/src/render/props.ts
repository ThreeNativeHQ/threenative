import { GroundSnap, InstancedBatch, createRandom, mergeParts } from "@threenative/core";
import type { IPlacement, IPlacementOverride } from "@threenative/terrain";
import {
  type BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Group,
  IcosahedronGeometry,
  type InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from "three";

// Supplied Strata starter shapes, kept in editable game source. PBR art is a later milestone.
function shape(asset: string): BufferGeometry {
  const pieces: { geometry: BufferGeometry; color: number }[] = [];
  if (asset === "pine") {
    const random = createRandom(82);
    for (let i = 0; i < 5; i++) {
      const geometry = new ConeGeometry(3.6 - i * 0.5, 6.3 - i * 0.65, 12, 3);
      const positions = geometry.getAttribute("position");
      for (let k = 0; k < positions.count; k++) {
        const f = 1 + (random() - 0.5) * 0.2;
        positions.setXYZ(
          k,
          positions.getX(k) * f,
          positions.getY(k) + (random() - 0.5) * 0.3,
          positions.getZ(k) * f,
        );
      }
      geometry.translate(0, 4 + i * 1.65, 0);
      geometry.computeVertexNormals();
      pieces.push({ geometry, color: 0x335039 });
    }
    pieces.push({
      geometry: new CylinderGeometry(0.19, 0.48, 8, 7).translate(0, 4, 0),
      color: 0x62503a,
    });
  } else if (asset === "boulder") {
    const geometry = new IcosahedronGeometry(1.9, 2);
    const positions = geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);
      const f = 1 + 0.12 * Math.sin(x * 9 + z * 8) * Math.cos(y * 7);
      positions.setXYZ(i, x * f, y * 0.7 * f + 0.85, z * 0.82 * f);
    }
    geometry.computeVertexNormals();
    pieces.push({ geometry, color: 0x77796b });
  } else {
    for (let i = 0; i < 5; i++) {
      const geometry = new ConeGeometry(0.16, 1.4, 3)
        .rotateZ((i - 2) * 0.11)
        .translate((i - 2) * 0.14, 0.7, Math.sin(i) * 0.22);
      pieces.push({ geometry, color: 0x6f7945 });
    }
  }
  try {
    return mergeParts(pieces, { label: asset, preserve: ["normal", "uv"] });
  } finally {
    for (const part of pieces) part.geometry.dispose();
  }
}

export type PropGroundQuery = (
  placement: IPlacement,
  position: [number, number, number],
) => { height: number | null; offset: number };
export interface IPropInstance {
  mesh: InstancedMesh;
  index: number;
  placement: IPlacement;
  grounding: boolean;
  clearance: number | null;
}
function preparePose(
  geometry: BufferGeometry,
  material: Material | Material[],
  placement: IPlacement,
  transform: IPlacementOverride | undefined,
  groundAt: PropGroundQuery,
) {
  // This measurement mesh is never added to the scene; the actual draw stays instanced.
  const model = new Mesh(geometry, material);
  model.position.fromArray(transform?.position ?? placement.position);
  if (transform) {
    model.quaternion.fromArray(transform.quaternion);
    model.scale.fromArray(transform.scale);
  } else {
    const up = new Vector3(0, 1, 0);
    if (placement.alignToNormal)
      model.quaternion.setFromUnitVectors(up, new Vector3().fromArray(placement.normal));
    model.quaternion.multiply(new Quaternion().setFromAxisAngle(up, placement.rotation));
    model.scale.setScalar(placement.scale);
  }
  const grounding = transform?.grounding ?? true;
  const ground = groundAt(placement, model.position.toArray());
  const snap = new GroundSnap(model, { enabled: grounding });
  if (ground.height === null) {
    if (grounding) throw new Error(`Missing terrain ground for '${placement.id}'`);
  } else {
    snap.apply(model, ground.height, 0);
    if (grounding && ground.offset !== 0) {
      model.position.y += ground.offset;
      snap.enabled = false;
      snap.apply(model, ground.height, 0);
    }
  }
  model.updateMatrix();
  if (!new Float32Array(model.matrix.elements).every(Number.isFinite))
    throw new Error(`Transform exceeds the renderer range for '${placement.id}'`);
  return { matrix: model.matrix.clone(), grounding, clearance: snap.clearance };
}
export function preparePropTransform(
  instance: IPropInstance,
  transform: IPlacementOverride | undefined,
  groundAt: PropGroundQuery,
) {
  return preparePose(
    instance.mesh.geometry,
    instance.mesh.material,
    instance.placement,
    transform,
    groundAt,
  );
}
export function writePropTransform(
  instance: IPropInstance,
  prepared: ReturnType<typeof preparePropTransform>,
): void {
  instance.mesh.setMatrixAt(instance.index, prepared.matrix);
  instance.mesh.instanceMatrix.needsUpdate = true;
  instance.mesh.computeBoundingSphere();
  instance.grounding = prepared.grounding;
  instance.clearance = prepared.clearance;
}
export function readPropTransform(instance: IPropInstance): IPlacementOverride {
  const matrix = new Matrix4();
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  instance.mesh.getMatrixAt(instance.index, matrix);
  matrix.decompose(position, quaternion, scale);
  return {
    position: position.toArray(),
    quaternion: quaternion.normalize().toArray(),
    scale: scale.toArray(),
    grounding: instance.grounding,
  };
}
export function createProps(placements: readonly IPlacement[], groundAt: PropGroundQuery) {
  const grouped = new Map<string, IPlacement[]>();
  for (const placement of placements) {
    if (!["pine", "boulder", "grass"].includes(placement.asset))
      throw new Error(`Unregistered prop asset '${placement.asset}'`);
    const group = grouped.get(placement.asset) ?? [];
    group.push(placement);
    grouped.set(placement.asset, group);
  }
  const object = new Group();
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.96 });
  const geometries: BufferGeometry[] = [];
  const meshes: InstancedMesh[] = [];
  const byId = new Map<string, IPropInstance>();
  function dispose(): void {
    for (const mesh of meshes) mesh.dispose();
    for (const geometry of geometries) geometry.dispose();
    material.dispose();
    object.clear();
    byId.clear();
  }
  try {
    for (const [asset, entries] of grouped) {
      const geometry = shape(asset);
      geometries.push(geometry);
      const batch = new InstancedBatch({ geometry, material });
      const prepared = entries.map((placement) =>
        preparePose(geometry, material, placement, placement.transform, groundAt),
      );
      for (const pose of prepared) {
        const position = new Vector3();
        const rotation = new Quaternion();
        const scale = new Vector3();
        pose.matrix.decompose(position, rotation, scale);
        const euler = new Euler().setFromQuaternion(rotation);
        batch.place({
          position: position.toArray(),
          rotation: [euler.x, euler.y, euler.z],
          scale: scale.toArray(),
        });
      }
      const mesh = batch.build({
        name: `props:${asset}`,
        parent: object,
        castShadow: true,
        receiveShadow: true,
      });
      if (!mesh) throw new Error(`Empty prop batch '${asset}'`);
      mesh.userData.placementIds = entries.map((placement) => placement.id);
      meshes.push(mesh);
      prepared.forEach((pose, index) => {
        const placement = entries[index];
        if (!placement) throw new Error(`Placement/pose mismatch '${asset}'`);
        mesh.setMatrixAt(index, pose.matrix);
        byId.set(placement.id, {
          mesh,
          index,
          placement,
          grounding: pose.grounding,
          clearance: pose.clearance,
        });
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    return { object, meshes, byId, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

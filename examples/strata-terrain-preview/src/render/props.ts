import { InstancedBatch, createRandom, mergeParts } from "@threenative/core";
import type { IPlacement } from "@threenative/terrain";
import {
  type BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Group,
  IcosahedronGeometry,
  type InstancedMesh,
  Matrix4,
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

export function createProps(
  placements: readonly IPlacement[],
  groundAt: (placement: IPlacement) => number,
) {
  const grouped = new Map<string, { placement: IPlacement; ground: number }[]>();
  for (const placement of placements) {
    if (!["pine", "boulder", "grass"].includes(placement.asset))
      throw new Error(`Unregistered prop asset '${placement.asset}'`);
    const ground = groundAt(placement);
    if (!Number.isFinite(ground)) throw new Error(`Missing prop ground '${placement.id}'`);
    const group = grouped.get(placement.asset) ?? [];
    group.push({ placement, ground });
    grouped.set(placement.asset, group);
  }
  const object = new Group();
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.96 });
  const geometries: BufferGeometry[] = [];
  const meshes: InstancedMesh[] = [];
  function dispose(): void {
    for (const mesh of meshes) mesh.dispose();
    for (const geometry of geometries) geometry.dispose();
    material.dispose();
    object.clear();
  }
  try {
    for (const [asset, entries] of grouped) {
      const geometry = shape(asset);
      geometries.push(geometry);
      geometry.computeBoundingBox();
      const bounds = geometry.boundingBox;
      if (!bounds) throw new Error(`Missing prop bounds '${asset}'`);
      const batch = new InstancedBatch({ geometry, material });
      for (const { placement, ground } of entries) {
        const up = new Vector3(0, 1, 0);
        const rotation = new Quaternion();
        if (placement.alignToNormal)
          rotation.setFromUnitVectors(up, new Vector3().fromArray(placement.normal));
        rotation.multiply(new Quaternion().setFromAxisAngle(up, placement.rotation));
        const transform = new Matrix4().compose(
          new Vector3(),
          rotation,
          new Vector3().setScalar(placement.scale),
        );
        const bottom = bounds.clone().applyMatrix4(transform).min.y;
        const euler = new Euler().setFromQuaternion(rotation);
        batch.place({
          position: [placement.position[0], ground - bottom, placement.position[2]],
          rotation: [euler.x, euler.y, euler.z],
          scale: placement.scale,
        });
      }
      const mesh = batch.build({
        name: `props:${asset}`,
        parent: object,
        castShadow: true,
        receiveShadow: true,
      });
      if (!mesh) throw new Error(`Empty prop batch '${asset}'`);
      mesh.userData.placementIds = entries.map(({ placement }) => placement.id);
      meshes.push(mesh);
    }
    return { object, meshes, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

import { sha256 } from "./identity.js";

export const MESH_VIEWPORT = { width: 1920, height: 1080 } as const;
export const MESH_LOADS = [1000, 5000, 10000, 20000, 50000] as const;
export type MeshVariant =
  | "static"
  | "rotating"
  | "rotating-projection-off"
  | "rotating-instanced"
  | "rotating-64-materials";

export interface IMeshFixtureObject {
  id: number;
  material: number;
  x: number;
  y: number;
  z: number;
}

export const MESH_FIXTURE = {
  antialias: false,
  backgroundColor: 0x101820,
  boxSize: 1,
  cameraTargetX: 0,
  cameraTargetY: 0,
  cameraTargetZ: 0,
  cameraFar: 4000,
  cameraFov: 60,
  cameraNear: 0.1,
  cameraYScale: 0.8,
  cameraZScale: 1.4,
  materialColor: 0xb8c4cc,
  materialColorStep: 0x010307,
  pixelRatio: 1,
  rotationXFrame: 0.013,
  rotationXIndex: 0.011,
  rotationYFrame: 0.02,
  rotationYIndex: 0.017,
  spacing: 2,
} as const;

export function meshMotion(variant: MeshVariant): "static" | "rotating" {
  return variant === "static" ? "static" : "rotating";
}

export function meshMaterialCount(variant: MeshVariant): number {
  return variant === "rotating-64-materials" ? 64 : 1;
}

export function meshMaterialColor(index: number): number {
  return (MESH_FIXTURE.materialColor + index * MESH_FIXTURE.materialColorStep) & 0xffffff;
}

export function meshObjects(count: number, variant: MeshVariant): IMeshFixtureObject[] {
  if (!Number.isInteger(count) || count < 1) throw new Error("TN_BENCH_BAD_MESH_COUNT");
  const side = Math.ceil(Math.sqrt(count));
  const half = (side - 1) / 2;
  const materials = meshMaterialCount(variant);
  return Array.from({ length: count }, (_, id) => ({
    id,
    material: id % materials,
    x: ((id % side) - half) * MESH_FIXTURE.spacing,
    y: 0,
    z: (Math.floor(id / side) - half) * MESH_FIXTURE.spacing,
  }));
}

/** One visible state for every arm: optimization class never changes motion or placement. */
export function meshRotation(id: number, frameId: number, variant: MeshVariant): [number, number] {
  if (meshMotion(variant) === "static") return [0, 0];
  return [
    id * MESH_FIXTURE.rotationXIndex + frameId * MESH_FIXTURE.rotationXFrame,
    id * MESH_FIXTURE.rotationYIndex + frameId * MESH_FIXTURE.rotationYFrame,
  ];
}

export function meshCamera(count: number): { x: number; y: number; z: number } {
  const span = Math.ceil(Math.sqrt(count)) * MESH_FIXTURE.spacing;
  return { x: 0, y: span * MESH_FIXTURE.cameraYScale, z: span * MESH_FIXTURE.cameraZScale };
}

/** Versioned little-endian input bytes; no projected/instanced implementation choice enters here. */
export function meshFixtureBytes(
  objects: readonly IMeshFixtureObject[],
  variant: MeshVariant,
): Uint8Array {
  const header = new TextEncoder().encode(
    `threenative-independent-meshes-v1\n${meshMotion(variant)}\n${JSON.stringify(MESH_FIXTURE)}\n${JSON.stringify(MESH_VIEWPORT)}\n`,
  );
  const body = new Uint8Array(4 + objects.length * 32);
  const view = new DataView(body.buffer);
  view.setUint32(0, objects.length, true);
  for (const [index, object] of objects.entries()) {
    const offset = 4 + index * 32;
    view.setUint32(offset, object.id, true);
    view.setUint32(offset + 4, object.material, true);
    view.setFloat64(offset + 8, object.x, true);
    view.setFloat64(offset + 16, object.y, true);
    view.setFloat64(offset + 24, object.z, true);
  }
  const bytes = new Uint8Array(header.length + body.length);
  bytes.set(header);
  bytes.set(body, header.length);
  return bytes;
}

export async function meshFixtureHash(
  objects: readonly IMeshFixtureObject[],
  variant: MeshVariant,
): Promise<string> {
  return sha256(meshFixtureBytes(objects, variant));
}

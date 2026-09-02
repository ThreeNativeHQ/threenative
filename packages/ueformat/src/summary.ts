import type { IUEModelData } from "./types.js";

export interface IUEModelSummary {
  objectName: string;
  objectPath: string;
  formatVersion: number;
  compression: string | null;
  lods: Array<{
    name: string;
    vertices: number;
    triangles: number;
    materials: string[];
    uvChannels: string[];
    vertexColorChannels: string[];
    weights: number;
    morphTargets: string[];
  }>;
  skeleton: { bones: number; sockets: number; virtualBones: number } | null;
  collisionMeshes: Array<{ name: string; vertices: number; triangles: number }>;
  unknownAttributes: string[];
}

export function summarizeUEModel(model: IUEModelData): IUEModelSummary {
  return {
    objectName: model.header.objectName,
    objectPath: model.header.objectPath,
    formatVersion: model.header.fileVersion,
    compression: model.header.compression?.format ?? null,
    lods: model.lods.map((lod) => ({
      name: lod.name,
      vertices: lod.vertices.length,
      triangles: lod.indices.length / 3,
      materials: lod.materials.map((material) => material.materialName),
      uvChannels: lod.texCoords.map((channel) => channel.name),
      vertexColorChannels: lod.vertexColors.map((channel) => channel.name),
      weights: lod.weights.length,
      morphTargets: lod.morphTargets.map((target) => target.name),
    })),
    skeleton:
      model.skeleton === null
        ? null
        : {
            bones: model.skeleton.bones.length,
            sockets: model.skeleton.sockets.length,
            virtualBones: model.skeleton.virtualBones.length,
          },
    collisionMeshes: model.collision.map((collision) => ({
      name: collision.name,
      vertices: collision.vertices.length,
      triangles: collision.indices.length / 3,
    })),
    unknownAttributes: [
      ...model.unknownAttributes,
      ...model.lods.flatMap((lod) => lod.unknownAttributes.map((name) => `${lod.name}:${name}`)),
      ...(model.skeleton?.unknownAttributes.map((name) => `SKELETON:${name}`) ?? []),
    ],
  };
}

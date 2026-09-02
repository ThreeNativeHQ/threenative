import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LOD,
  type Material,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  Uint16BufferAttribute,
} from "three";

import { UEFormatError } from "./errors.js";
import type {
  IUEModelCollision,
  IUEModelData,
  IUEModelLOD,
  IUEModelMaterial,
  IVector3,
} from "./types.js";

export type UECoordinateSystem = "three-y-up" | "unreal-z-up";
export type WindingRepair = "auto" | "always" | "never";

export interface IThreeAdapterOptions {
  coordinateSystem?: UECoordinateSystem;
  unitScale?: number;
  flipV?: boolean;
  repairWinding?: WindingRepair;
  lodDistances?: readonly number[];
  materialFactory?: (slot: IUEModelMaterial, materialIndex: number, lod: IUEModelLOD) => Material;
}

interface IResolvedOptions {
  coordinateSystem: UECoordinateSystem;
  unitScale: number;
  flipV: boolean;
  flipWinding: boolean;
  lodDistances?: readonly number[];
  materialFactory: NonNullable<IThreeAdapterOptions["materialFactory"]>;
}

function resolveOptions(options: IThreeAdapterOptions): IResolvedOptions {
  const coordinateSystem = options.coordinateSystem ?? "three-y-up";
  const unitScale = options.unitScale ?? 0.01;
  if (!Number.isFinite(unitScale) || unitScale <= 0) {
    throw new UEFormatError(
      "INVALID_GEOMETRY",
      `unitScale must be positive; received ${unitScale}`,
    );
  }
  const repairWinding = options.repairWinding ?? "auto";
  const flipWinding =
    repairWinding === "always" || (repairWinding === "auto" && coordinateSystem === "three-y-up");
  return {
    coordinateSystem,
    unitScale,
    flipV: options.flipV ?? coordinateSystem === "three-y-up",
    flipWinding,
    ...(options.lodDistances === undefined ? {} : { lodDistances: options.lodDistances }),
    // The default matches three.js's own GLTFLoader: a plain MeshStandardMaterial named after
    // the slot. No colour, roughness or metalness is decided here — every look parameter comes
    // from the game, through materialFactory.
    materialFactory:
      options.materialFactory ?? ((slot) => new MeshStandardMaterial({ name: slot.materialName })),
  };
}

function convertVector(
  value: IVector3,
  options: IResolvedOptions,
  scale: number,
): [number, number, number] {
  const amount = scale;
  const clean = (component: number) => (Object.is(component, -0) ? 0 : component);
  if (options.coordinateSystem === "unreal-z-up") {
    return [clean(value.x * amount), clean(value.y * amount), clean(value.z * amount)];
  }
  return [clean(value.y * amount), clean(value.z * amount), clean(-value.x * amount)];
}

function flattenVectors(
  values: readonly IVector3[],
  options: IResolvedOptions,
  scale: number,
): number[] {
  const result = new Array<number>(values.length * 3);
  let offset = 0;
  for (const value of values) {
    const converted = convertVector(value, options, scale);
    result[offset++] = converted[0];
    result[offset++] = converted[1];
    result[offset++] = converted[2];
  }
  return result;
}

function transformedIndices(indices: readonly number[], flipWinding: boolean): number[] {
  const result = Array.from(indices);
  if (flipWinding) {
    for (let index = 0; index + 2 < result.length; index += 3) {
      const second = result[index + 1] ?? 0;
      result[index + 1] = result[index + 2] ?? 0;
      result[index + 2] = second;
    }
  }
  return result;
}

function validateLod(lod: IUEModelLOD): void {
  const vertexCount = lod.vertices.length;
  if (vertexCount === 0) {
    throw new UEFormatError("INVALID_GEOMETRY", `${lod.name} contains no vertices`);
  }
  if (lod.indices.length === 0 || lod.indices.length % 3 !== 0) {
    throw new UEFormatError(
      "INVALID_GEOMETRY",
      `${lod.name} index count must be a non-zero multiple of 3`,
    );
  }
  for (const index of lod.indices) {
    if (!Number.isInteger(index) || index < 0 || index >= vertexCount) {
      throw new UEFormatError(
        "INVALID_GEOMETRY",
        `${lod.name} contains out-of-range index ${index}`,
      );
    }
  }
  for (const [label, count] of [
    ["normal", lod.normals.length],
    ["tangent", lod.tangents.length],
  ] as const) {
    if (count !== 0 && count !== vertexCount) {
      throw new UEFormatError(
        "INVALID_GEOMETRY",
        `${lod.name} ${label} count ${count} does not match ${vertexCount} vertices`,
      );
    }
  }
  for (const channel of lod.texCoords) {
    if (channel.uvs.length !== vertexCount) {
      throw new UEFormatError(
        "INVALID_GEOMETRY",
        `${lod.name} UV channel ${channel.name} has the wrong length`,
      );
    }
  }
  for (const channel of lod.vertexColors) {
    if (channel.colors.length !== vertexCount) {
      throw new UEFormatError(
        "INVALID_GEOMETRY",
        `${lod.name} color channel ${channel.name} has the wrong length`,
      );
    }
  }
  for (const section of lod.materials) {
    const count = section.numFaces * 3;
    if (
      !Number.isInteger(section.firstIndex) ||
      !Number.isInteger(section.numFaces) ||
      section.firstIndex < 0 ||
      section.numFaces < 0 ||
      section.firstIndex + count > lod.indices.length
    ) {
      throw new UEFormatError(
        "INVALID_GEOMETRY",
        `${lod.name} has an invalid material section ${section.materialName}`,
      );
    }
  }
  for (const target of lod.morphTargets) {
    for (const delta of target.deltas) {
      if (delta.vertexIndex < 0 || delta.vertexIndex >= vertexCount) {
        throw new UEFormatError(
          "INVALID_GEOMETRY",
          `${lod.name} morph ${target.name} references vertex ${delta.vertexIndex}`,
        );
      }
    }
  }
  for (const weight of lod.weights) {
    if (weight.vertexIndex < 0 || weight.vertexIndex >= vertexCount || weight.boneIndex < 0) {
      throw new UEFormatError("INVALID_GEOMETRY", `${lod.name} contains an invalid skin weight`);
    }
  }
}

function addUvAttributes(
  geometry: BufferGeometry,
  lod: IUEModelLOD,
  options: IResolvedOptions,
): void {
  lod.texCoords.forEach((channel, channelIndex) => {
    const values = new Array<number>(channel.uvs.length * 2);
    let offset = 0;
    for (const uv of channel.uvs) {
      values[offset++] = uv.u;
      values[offset++] = options.flipV ? 1 - uv.v : uv.v;
    }
    geometry.setAttribute(
      channelIndex === 0 ? "uv" : `uv${channelIndex}`,
      new Float32BufferAttribute(values, 2),
    );
  });
}

function addColorAttributes(geometry: BufferGeometry, lod: IUEModelLOD): void {
  lod.vertexColors.forEach((channel, channelIndex) => {
    const values = new Array<number>(channel.colors.length * 3);
    let offset = 0;
    for (const color of channel.colors) {
      values[offset++] = color.r / 255;
      values[offset++] = color.g / 255;
      values[offset++] = color.b / 255;
    }
    geometry.setAttribute(
      channelIndex === 0 ? "color" : `color${channelIndex}`,
      new Float32BufferAttribute(values, 3),
    );
  });
}

function addMorphAttributes(
  geometry: BufferGeometry,
  lod: IUEModelLOD,
  options: IResolvedOptions,
): void {
  if (lod.morphTargets.length === 0) return;
  geometry.morphAttributes.position = lod.morphTargets.map((target) => {
    const values = new Float32Array(lod.vertices.length * 3);
    for (const delta of target.deltas) {
      const converted = convertVector(delta.positionDelta, options, options.unitScale);
      const offset = delta.vertexIndex * 3;
      values[offset] = converted[0];
      values[offset + 1] = converted[1];
      values[offset + 2] = converted[2];
    }
    const attribute = new Float32BufferAttribute(values, 3);
    attribute.name = target.name;
    return attribute;
  });
  geometry.morphTargetsRelative = true;
}

function addSkinAttributes(geometry: BufferGeometry, lod: IUEModelLOD): void {
  if (lod.weights.length === 0) return;
  const perVertex = new Map<number, Array<{ bone: number; weight: number }>>();
  for (const weight of lod.weights) {
    const influences = perVertex.get(weight.vertexIndex) ?? [];
    influences.push({ bone: weight.boneIndex, weight: weight.weight });
    perVertex.set(weight.vertexIndex, influences);
  }
  const indices = new Uint16Array(lod.vertices.length * 4);
  const weights = new Float32Array(lod.vertices.length * 4);
  perVertex.forEach((influences, vertexIndex) => {
    const selected = influences
      .filter((influence) => Number.isFinite(influence.weight) && influence.weight > 0)
      .sort((left, right) => right.weight - left.weight)
      .slice(0, 4);
    const total = selected.reduce((sum, influence) => sum + influence.weight, 0);
    selected.forEach((influence, influenceIndex) => {
      const offset = vertexIndex * 4 + influenceIndex;
      indices[offset] = influence.bone;
      weights[offset] = total === 0 ? 0 : influence.weight / total;
    });
  });
  geometry.setAttribute("skinIndex", new Uint16BufferAttribute(indices, 4));
  geometry.setAttribute("skinWeight", new Float32BufferAttribute(weights, 4));
}

export function createThreeGeometry(
  lod: IUEModelLOD,
  adapterOptions: IThreeAdapterOptions = {},
): BufferGeometry {
  validateLod(lod);
  const options = resolveOptions(adapterOptions);
  const geometry = new BufferGeometry();
  geometry.name = lod.name;
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(flattenVectors(lod.vertices, options, options.unitScale), 3),
  );
  geometry.setIndex(transformedIndices(lod.indices, options.flipWinding));

  if (lod.normals.length > 0) {
    geometry.setAttribute(
      "normal",
      new Float32BufferAttribute(flattenVectors(lod.normals, options, 1), 3),
    );
  } else {
    geometry.computeVertexNormals();
  }
  if (lod.tangents.length > 0) {
    const tangents = new Array<number>(lod.tangents.length * 4);
    let offset = 0;
    lod.tangents.forEach((tangent, index) => {
      const converted = convertVector(tangent, options, 1);
      tangents[offset++] = converted[0];
      tangents[offset++] = converted[1];
      tangents[offset++] = converted[2];
      tangents[offset++] = (lod.normals[index]?.binormalSign ?? 1) * (options.flipWinding ? -1 : 1);
    });
    geometry.setAttribute("tangent", new Float32BufferAttribute(tangents, 4));
  }

  addUvAttributes(geometry, lod, options);
  addColorAttributes(geometry, lod);
  addMorphAttributes(geometry, lod, options);
  addSkinAttributes(geometry, lod);
  lod.materials.forEach((section, materialIndex) => {
    geometry.addGroup(section.firstIndex, section.numFaces * 3, materialIndex);
  });
  geometry.userData.ue = {
    lodName: lod.name,
    materialSlots: lod.materials,
    vertexColorChannels: lod.vertexColors.map((channel) => channel.name),
    uvChannels: lod.texCoords.map((channel) => channel.name),
  };
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function materialSlots(lod: IUEModelLOD): IUEModelMaterial[] {
  if (lod.materials.length > 0) return lod.materials;
  return [
    {
      materialName: "DefaultMaterial",
      materialPath: "",
      firstIndex: 0,
      numFaces: lod.indices.length / 3,
    },
  ];
}

function createMesh(lod: IUEModelLOD, options: IResolvedOptions): Mesh {
  const geometry = createThreeGeometry(lod, options);
  const materials = materialSlots(lod).map((slot, index) =>
    options.materialFactory(slot, index, lod),
  );
  const mesh = new Mesh(geometry, materials.length === 1 ? materials[0] : materials);
  mesh.name = lod.name;
  mesh.userData.ue = { lod };
  return mesh;
}

function createCollisionGeometry(
  collision: IUEModelCollision,
  options: IResolvedOptions,
): BufferGeometry {
  const pseudoLod: IUEModelLOD = {
    name: collision.name,
    vertices: collision.vertices,
    normals: [],
    tangents: [],
    texCoords: [],
    indices: collision.indices,
    vertexColors: [],
    materials: [],
    weights: [],
    morphTargets: [],
    unknownAttributes: [],
  };
  return createThreeGeometry(pseudoLod, options);
}

export function createThreeObject(
  model: IUEModelData,
  adapterOptions: IThreeAdapterOptions = {},
): Group | LOD {
  const options = resolveOptions(adapterOptions);
  let object: Group | LOD;
  if (model.lods.length > 1) {
    const lodObject = new LOD();
    model.lods.forEach((lod, index) => {
      const defaultDistance = index === 0 ? 0 : 10 * 2 ** (index - 1);
      const distance = options.lodDistances?.[index] ?? defaultDistance;
      if (!Number.isFinite(distance) || distance < 0) {
        throw new UEFormatError("INVALID_GEOMETRY", `LOD distance ${distance} is invalid`);
      }
      lodObject.addLevel(createMesh(lod, options), distance);
    });
    object = lodObject;
  } else {
    const group = new Group();
    if (model.lods[0]) group.add(createMesh(model.lods[0], options));
    object = group;
  }
  object.name = model.header.objectName;
  const collisionGeometries = model.collision.map((collision) =>
    createCollisionGeometry(collision, options),
  );
  object.userData.ue = {
    header: model.header,
    skeleton: model.skeleton,
    collisionGeometries,
    source: model,
  };
  return object;
}

export type UEFormatThreeObject = Group | LOD | Object3D;

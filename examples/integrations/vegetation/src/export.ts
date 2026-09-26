import { type Accessor, type Buffer, Document, type GLTF, NodeIO } from "@gltf-transform/core";
import type { TypedArray } from "@gltf-transform/core";
import type { BufferAttribute, BufferGeometry } from "three";
import { InterleavedBufferAttribute, Mesh } from "three";
import type { IGeneratedTree } from "./tree.js";

/** generateTree adds the donor's branches mesh before its leaves mesh, so child order is the role. */
const ROLES = ["branches", "leaves"] as const;
/** [glTF semantic, three attribute name, accessor type, components per vertex] */
const ATTRIBUTES = [
  ["POSITION", "position", "VEC3", 3],
  ["NORMAL", "normal", "VEC3", 3],
  ["TEXCOORD_0", "uv", "VEC2", 2],
  // Custom semantic: glTF requires the underscore, and GLTFLoader hands an unknown semantic
  // back under its lower-cased name, so a cooked tree arrives with the same `_wind` attribute.
  ["_WIND", "_wind", "SCALAR", 1],
] as const;

function accessor(
  document: Document,
  buffer: Buffer,
  name: string,
  attribute: BufferAttribute | InterleavedBufferAttribute,
  type: GLTF.AccessorType,
  itemSize: number,
): Accessor {
  if (attribute instanceof InterleavedBufferAttribute)
    throw new Error(
      `Tree ${name} ${type} is interleaved; the export needs a plain attribute buffer.`,
    );
  if (attribute.itemSize !== itemSize)
    throw new Error(
      `Tree ${name} ${type} has ${attribute.itemSize} components, expected ${itemSize}.`,
    );
  return document
    .createAccessor(`${name}_${type}`)
    .setType(type)
    .setArray(attribute.array as TypedArray)
    .setBuffer(buffer);
}

/**
 * Offline authoring step: one binary glTF per generated variant, for a game to re-material.
 * The colours here are neutral placeholders; the look stays game-owned. No browser globals.
 */
export async function treeToGlb(tree: IGeneratedTree): Promise<Uint8Array> {
  const meshes: Mesh[] = [];
  tree.root.traverse((object) => {
    if (object instanceof Mesh) meshes.push(object);
  });
  if (meshes.length !== ROLES.length)
    throw new Error(`Tree export needs exactly ${ROLES.length} meshes, found ${meshes.length}.`);
  const document = new Document();
  const buffer = document.createBuffer();
  const bark = document
    .createMaterial("bark")
    .setBaseColorFactor([0.4, 0.4, 0.4, 1])
    .setMetallicFactor(0)
    .setRoughnessFactor(1)
    .setAlphaMode("OPAQUE");
  const leaf = document
    .createMaterial("leaf")
    .setBaseColorFactor([0.5, 0.5, 0.5, 1])
    .setMetallicFactor(0)
    .setRoughnessFactor(1)
    .setAlphaMode("MASK")
    .setAlphaCutoff(0.5)
    .setDoubleSided(true);
  const root = document.createNode("Tree");
  for (const [i, role] of ROLES.entries()) {
    const geometry = meshes[i]?.geometry;
    if (!geometry) throw new Error(`Tree export lost its ${role} geometry.`);
    const index = geometry.getIndex();
    if (!index) throw new Error(`Tree ${role} geometry has no index buffer.`);
    const primitive = document
      .createPrimitive()
      .setIndices(accessor(document, buffer, role, index, "SCALAR", 1))
      .setMaterial(role === "branches" ? bark : leaf);
    for (const [semantic, name, type, itemSize] of ATTRIBUTES) {
      const attribute = geometry.getAttribute(name);
      if (!attribute)
        throw new Error(`Tree ${role} geometry has no ${name} (${semantic}) attribute.`);
      primitive.setAttribute(semantic, accessor(document, buffer, role, attribute, type, itemSize));
    }
    root.addChild(
      document.createNode(role).setMesh(document.createMesh(role).addPrimitive(primitive)),
    );
  }
  document.getRoot().setDefaultScene(document.createScene("Tree").addChild(root));
  return new NodeIO().writeBinary(document);
}

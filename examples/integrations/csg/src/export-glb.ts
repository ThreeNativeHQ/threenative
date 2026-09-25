import { Accessor, Document, NodeIO } from '@gltf-transform/core';
import { DoubleSide, type Mesh, type MeshStandardMaterial } from 'three';
import { exportGeometry } from './csg.js';

/** Bounded authoring bridge: standard untextured PBR solids only, no DOM/FileReader shims. */
export async function writeSolidGlb(mesh: Mesh): Promise<Uint8Array> {
  const geometry = exportGeometry(mesh.geometry);
  try {
    mesh.updateWorldMatrix(true, false);
    if (!Number.isFinite(mesh.matrixWorld.determinant()) || Math.abs(mesh.matrixWorld.determinant()) < 1e-12)
      throw new Error('CSG export transform is singular or non-finite.');
    geometry.applyMatrix4(mesh.matrixWorld);
    if (!geometry.index || geometry.index.count === 0) throw new Error('CSG result is empty; no GLB was written.');
    const document = new Document(); const buffer = document.createBuffer();
    const scene = document.createScene('CSG'); document.getRoot().setDefaultScene(scene);
    const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(source => {
      const material = source as MeshStandardMaterial;
      if (!material.isMeshStandardMaterial || 'isMeshPhysicalMaterial' in material || material.wireframe)
        throw new Error(`CSG export material '${source.name}' is not an admitted standard PBR material.`);
      for (const value of Object.values(material))
        if (value && typeof value === 'object' && 'isTexture' in value)
          throw new Error(`CSG export material '${source.name}' has a texture; use the ordinary textured asset authoring path.`);
      const { r, g, b } = material.color; const e = material.emissive;
      if (![r,g,b,material.opacity,material.metalness,material.roughness,e.r,e.g,e.b,material.emissiveIntensity].every(Number.isFinite))
        throw new Error(`CSG export material '${source.name}' has non-finite factors.`);
      return document.createMaterial(source.name)
        .setBaseColorFactor([r,g,b,material.opacity]).setMetallicFactor(material.metalness)
        .setRoughnessFactor(material.roughness).setDoubleSided(material.side === DoubleSide)
        .setEmissiveFactor([e.r * material.emissiveIntensity,e.g * material.emissiveIntensity,e.b * material.emissiveIntensity])
        .setAlphaMode(material.transparent ? 'BLEND' : material.alphaTest > 0 ? 'MASK' : 'OPAQUE')
        .setAlphaCutoff(material.alphaTest > 0 ? material.alphaTest : 0.5);
    });
    const attributes = new Map<string, Accessor>();
    const semantics: Record<string, string> = { position:'POSITION', normal:'NORMAL', uv:'TEXCOORD_0', color:'COLOR_0' };
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
      const semantic = semantics[name];
      if (!semantic) throw new Error(`CSG export attribute '${name}' has no admitted glTF semantic.`);
      const values = new Float32Array(attribute.count * attribute.itemSize);
      for (let i=0;i<attribute.count;i++) for (let c=0;c<attribute.itemSize;c++)
        values[i*attribute.itemSize+c] = attribute.getComponent(i,c);
      const size = attribute.itemSize;
      if (size < 2 || size > 4) throw new Error(`CSG export attribute '${name}' has unsupported size ${size}.`);
      attributes.set(semantic, document.createAccessor(name).setBuffer(buffer)
        .setType(size === 2 ? Accessor.Type.VEC2 : size === 3 ? Accessor.Type.VEC3 : Accessor.Type.VEC4).setArray(values));
    }
    const output = document.createMesh(mesh.name);
    const groups = geometry.groups.length ? geometry.groups : [{ start:0, count:geometry.index.count, materialIndex:0 }];
    for (const group of groups) {
      const material = materials[group.materialIndex ?? 0];
      if (!material) throw new Error('CSG export group references a missing material.');
      const indices = geometry.index.array.slice(group.start, group.start + group.count) as Uint16Array | Uint32Array;
      const primitive = document.createPrimitive().setMaterial(material).setIndices(document.createAccessor()
        .setType(Accessor.Type.SCALAR).setBuffer(buffer).setArray(indices));
      for (const [semantic, attribute] of attributes) primitive.setAttribute(semantic, attribute);
      output.addPrimitive(primitive);
    }
    scene.addChild(document.createNode(mesh.name).setMesh(output));
    return await new NodeIO().writeBinary(document);
  } finally { geometry.dispose(); }
}

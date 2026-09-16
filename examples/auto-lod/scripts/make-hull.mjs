// Builds the example's one source model: a dense torus knot (12,800 triangles) written as a
// dependency-free GLB. A generated shape, not a scanned one — it exists so the example has a
// static, indexed, opaque model that clears `assets.lod`'s 5,000-triangle generation floor.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TorusKnotGeometry } from "three";

const here = dirname(fileURLToPath(import.meta.url));
const geometry = new TorusKnotGeometry(1, 0.34, 128, 32, 2, 3);
const position = geometry.getAttribute("position");
const index = geometry.getIndex();
if (position === undefined || index === undefined) throw new Error("torus knot is not indexed");

const positions = new Float32Array(position.array);
const indices = new Uint32Array(index.array);
const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
for (let vertex = 0; vertex < position.count; vertex += 1) {
  for (let axis = 0; axis < 3; axis += 1) {
    min[axis] = Math.min(min[axis], positions[vertex * 3 + axis]);
    max[axis] = Math.max(max[axis], positions[vertex * 3 + axis]);
  }
}

const pad = (buffer, fill) =>
  buffer.length % 4 === 0
    ? buffer
    : Buffer.concat([buffer, Buffer.alloc(4 - (buffer.length % 4), fill)]);
const positionBuffer = Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength);
const indexBuffer = Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength);
const bin = pad(Buffer.concat([positionBuffer, indexBuffer]), 0);

const json = pad(
  Buffer.from(
    JSON.stringify({
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: position.count,
          max,
          min,
          type: "VEC3",
        },
        { bufferView: 1, componentType: 5125, count: indices.length, type: "SCALAR" },
      ],
      asset: { generator: "examples/auto-lod make-hull", version: "2.0" },
      bufferViews: [
        { buffer: 0, byteLength: positionBuffer.length, byteOffset: 0, target: 34962 },
        {
          buffer: 0,
          byteLength: indexBuffer.length,
          byteOffset: positionBuffer.length,
          target: 34963,
        },
      ],
      buffers: [{ byteLength: bin.length }],
      materials: [
        { name: "hull", pbrMetallicRoughness: { metallicFactor: 0.1, roughnessFactor: 0.7 } },
      ],
      meshes: [
        // biome-ignore lint/style/useNamingConvention: `POSITION` is the glTF attribute semantic, fixed by the spec.
        { primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0, mode: 4 }] },
      ],
      nodes: [{ mesh: 0 }],
      scene: 0,
      scenes: [{ nodes: [0] }],
    }),
  ),
  0x20,
);

const total = 12 + 8 + json.length + 8 + bin.length;
const glb = Buffer.alloc(total);
glb.writeUInt32LE(0x46546c67, 0);
glb.writeUInt32LE(2, 4);
glb.writeUInt32LE(total, 8);
glb.writeUInt32LE(json.length, 12);
glb.writeUInt32LE(0x4e4f534a, 16);
json.copy(glb, 20);
glb.writeUInt32LE(bin.length, 20 + json.length);
glb.writeUInt32LE(0x004e4942, 24 + json.length);
bin.copy(glb, 28 + json.length);

const target = resolve(here, "../assets/hull.glb");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, glb);
console.log(`wrote ${target}: ${Math.floor(indices.length / 3)} triangles, ${glb.length} bytes`);

import { readFileSync } from "node:fs";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { reconcileMirroredClips } from "./dist/index.js";
globalThis.self ??= globalThis;
await MeshoptDecoder.ready;
for (const path of process.argv.slice(2)) {
  const bytes = readFileSync(path);
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await new Promise((resolve, reject) =>
    loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "", resolve, reject));
  const fired = reconcileMirroredClips(gltf.scene, gltf.animations);
  console.log(`${fired ? "REPAIR FIRES " : "clean        "} clips=${String(gltf.animations.length).padStart(2)}  ${path.split("/").slice(-3).join("/")}`);
}

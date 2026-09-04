import { readFileSync } from "node:fs";
globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
globalThis.URL.createObjectURL = () => "blob:stub";
import { Box3, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
const file = process.argv[2];
const buf = readFileSync(file);
const loader = new GLTFLoader();
loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "", (gltf) => {
  const box = new Box3().setFromObject(gltf.scene);
  const size = box.getSize(new Vector3()), c = box.getCenter(new Vector3());
  console.log("size", size.toArray().map(n=>n.toFixed(3)).join(","), "centre", c.toArray().map(n=>n.toFixed(3)).join(","));
  console.log("children:");
  gltf.scene.traverse((o) => {
    if (o.isMesh || o.isSkinnedMesh || o.isBone === undefined) {
      const b = new Box3().setFromObject(o);
      if (o.isMesh || o.isSkinnedMesh) console.log(" ", o.type, o.name, "bbox", b.min.toArray().map(n=>n.toFixed(2)).join(","), "->", b.max.toArray().map(n=>n.toFixed(2)).join(","));
    }
  });
  console.log("clips", gltf.animations.map(a=>a.name).join(","));
}, (e) => console.error("ERR", e));

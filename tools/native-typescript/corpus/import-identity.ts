import { BoxGeometry, Mesh, MeshStandardMaterial } from "three";
import { Mesh as WebGPUMesh } from "three/webgpu";
const a = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
const b = new WebGPUMesh(new BoxGeometry(), new MeshStandardMaterial());
if (
  Mesh !== WebGPUMesh ||
  !(a instanceof Mesh) ||
  !(a instanceof WebGPUMesh) ||
  !(b instanceof Mesh) ||
  !(b instanceof WebGPUMesh)
)
  throw "Mesh import identity failed";
console.log("same constructor; instanceof both ways");

import { BoxGeometry, Mesh, MeshBasicMaterial, Scene, Vector3 } from "three";
import { SceneRenderProjection } from "./src/renderProjection.js";

const scene = new Scene();
const geometry = new BoxGeometry(1, 1, 1);
const material = new MeshBasicMaterial();
const quads: Mesh[] = [];
for (let index = 0; index < 6; index += 1) {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(index * 2, 0, -index * 3);
  scene.add(mesh);
  quads.push(mesh);
}

const projection = new SceneRenderProjection(scene, { minMeshes: 1 });

// First reconcile: batch created here.
projection.reconcile();
for (const mesh of quads) {
  console.log("after-create", mesh.id, JSON.stringify(projection.inspect(mesh)));
}

// Now the game writes transforms AFTER the batch exists (the decal-field pattern).
for (const [index, mesh] of quads.entries()) {
  mesh.position.set(30 + index, 5, 20); // downrange where a camera would look
  mesh.updateMatrixWorld(true);
}
projection.reconcile();
for (const mesh of quads) {
  const seen = projection.inspect(mesh);
  const expected = mesh.matrixWorld.elements.join(",");
  console.log(
    "after-write",
    mesh.id,
    JSON.stringify(seen),
    "match=",
    seen ? seen.matrixWorld.elements.join(",") === expected : false,
  );
}
console.log("projecting:", projection.report.projecting, "batches:", projection.report.batches);

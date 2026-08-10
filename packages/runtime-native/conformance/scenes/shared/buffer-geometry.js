import { THREE, assertCondition, startVisualScene } from "./scene-support.js";

export function assertBufferGeometryProof(geometry) {
  assertCondition(geometry?.isBufferGeometry === true, "expected a BufferGeometry");
  assertCondition(geometry.getAttribute("position")?.count === 4, "position count must be four");
  assertCondition(geometry.getAttribute("position")?.itemSize === 3, "positions must be xyz");
  assertCondition(geometry.getAttribute("color")?.count === 4, "color count must match positions");
  assertCondition(geometry.index?.count === 6, "indexed quad must contain two triangles");
  geometry.computeBoundingBox();
  assertCondition(geometry.boundingBox !== null, "BufferGeometry bounding box is missing");
  assertCondition(
    Math.abs(geometry.boundingBox.min.x + 1.2) < 1e-6 &&
      Math.abs(geometry.boundingBox.max.x - 1.2) < 1e-6,
    "BufferGeometry x bounds are incorrect",
  );
}

export function startScene(canvas, dimensions) {
  return startVisualScene(canvas, dimensions, "buffer-geometry", ({ scene }) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([-1.2, -0.7, 0, 1.2, -0.7, 0, 1.2, 0.7, 0, -1.2, 0.7, 0], 3),
    );
    geometry.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(
        [0.95, 0.2, 0.25, 0.2, 0.75, 0.4, 0.2, 0.5, 1, 1, 0.7, 0.2],
        3,
      ),
    );
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    assertBufferGeometryProof(geometry);

    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true }));
    mesh.rotation.z = -0.12;
    scene.add(mesh);
    return { mesh, detail: { vertexCount: 4, indexCount: 6 } };
  });
}

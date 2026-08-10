import { THREE, assertCondition, startVisualScene } from "./scene-support.js";

function projectedWidth(camera, z) {
  const left = new THREE.Vector3(-0.5, 0, z).project(camera);
  const right = new THREE.Vector3(0.5, 0, z).project(camera);
  return right.x - left.x;
}

export function assertPerspectiveCameraProof(camera) {
  assertCondition(camera?.isPerspectiveCamera === true, "expected a PerspectiveCamera");
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const nearWidth = projectedWidth(camera, -2);
  const farWidth = projectedWidth(camera, -6);
  assertCondition(
    Number.isFinite(nearWidth) && Number.isFinite(farWidth),
    "projection is not finite",
  );
  assertCondition(nearWidth > farWidth * 2.9, "perspective projection did not shrink distance");
  return { nearWidth, farWidth };
}

export function startScene(canvas, dimensions) {
  return startVisualScene(
    canvas,
    dimensions,
    "perspective-camera",
    ({ scene, camera }) => {
      const proof = assertPerspectiveCameraProof(camera);
      const near = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.9, 0.18),
        new THREE.MeshBasicMaterial({ color: 0xf56565 }),
      );
      near.position.set(-0.65, 0, -2);
      const far = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.9, 0.18),
        new THREE.MeshBasicMaterial({ color: 0x48bb78 }),
      );
      far.position.set(1.95, 0, -6);
      scene.add(near, far);
      return { near, far, detail: proof };
    },
    {
      camera: (size) => new THREE.PerspectiveCamera(55, size.width / size.height, 0.1, 50),
    },
  );
}

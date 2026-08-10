import { THREE, assertCondition, startVisualScene } from "./scene-support.js";

function projectedWidth(camera, center, z) {
  const left = new THREE.Vector3(center - 0.5, 0, z).project(camera);
  const right = new THREE.Vector3(center + 0.5, 0, z).project(camera);
  return right.x - left.x;
}

export function assertOrthographicCameraProof(camera) {
  assertCondition(camera?.isOrthographicCamera === true, "expected an OrthographicCamera");
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const nearWidth = projectedWidth(camera, -1, 0);
  const farWidth = projectedWidth(camera, 1, -3);
  assertCondition(
    Number.isFinite(nearWidth) && Number.isFinite(farWidth),
    "projection is not finite",
  );
  assertCondition(Math.abs(nearWidth - farWidth) < 1e-12, "orthographic size changed with depth");
  return { nearWidth, farWidth };
}

export function startScene(canvas, dimensions) {
  return startVisualScene(
    canvas,
    dimensions,
    "orthographic-camera",
    ({ scene, camera }) => {
      const proof = assertOrthographicCameraProof(camera);
      const left = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 1.25, 0.2),
        new THREE.MeshBasicMaterial({ color: 0x4299e1 }),
      );
      left.position.set(-1, 0, 0);
      const right = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 1.25, 0.2),
        new THREE.MeshBasicMaterial({ color: 0xf6ad55 }),
      );
      right.position.set(1, 0, -3);
      scene.add(left, right);
      return { left, right, detail: proof };
    },
    {
      camera: (size) => {
        const aspect = size.width / size.height;
        const camera = new THREE.OrthographicCamera(-2 * aspect, 2 * aspect, 2, -2, 0.1, 20);
        camera.position.z = 4;
        return camera;
      },
    },
  );
}

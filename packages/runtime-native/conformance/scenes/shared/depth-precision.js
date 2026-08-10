import { THREE, assertCondition, startVisualScene } from "./scene-support.js";

function projectedDepth(camera, z) {
  return new THREE.Vector3(0, 0, z).project(camera).z;
}

export function assertDepthPrecisionProof(camera, frontZ = 0, backZ = -0.002) {
  assertCondition(camera?.isPerspectiveCamera === true, "depth proof requires PerspectiveCamera");
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const front = projectedDepth(camera, frontZ);
  const back = projectedDepth(camera, backZ);
  const separation = back - front;
  assertCondition(front < back, "near depth must sort before far depth");
  assertCondition(separation > 1e-7 && separation < 1e-3, "depth separation is not precise");
  return { front, back, separation };
}

export function startScene(canvas, dimensions) {
  return startVisualScene(
    canvas,
    dimensions,
    "depth-precision",
    ({ scene, camera }) => {
      const proof = assertDepthPrecisionProof(camera);
      const back = new THREE.Mesh(
        new THREE.PlaneGeometry(2.3, 1.55),
        new THREE.MeshBasicMaterial({ color: 0x3182ce, depthTest: true }),
      );
      back.position.z = -0.002;
      const front = new THREE.Mesh(
        new THREE.PlaneGeometry(1.35, 0.85),
        new THREE.MeshBasicMaterial({ color: 0xf6ad55, depthTest: true }),
      );
      front.position.z = 0;
      const marker = new THREE.Mesh(
        new THREE.TorusGeometry(0.62, 0.08, 12, 48),
        new THREE.MeshBasicMaterial({ color: 0x9ae6b4 }),
      );
      marker.position.z = 0.003;
      scene.add(back, front, marker);
      return { front, back, marker, detail: proof };
    },
    {
      camera: (size) => {
        const camera = new THREE.PerspectiveCamera(55, size.width / size.height, 0.01, 10_000);
        camera.position.z = 3.2;
        return camera;
      },
    },
  );
}

import * as THREE from "three/webgpu";

export function assertGpuValidationApi(device) {
  if (typeof device?.pushErrorScope !== "function" || typeof device?.popErrorScope !== "function") {
    throw new Error("GPU validation proof requires pushErrorScope and popErrorScope.");
  }
}

export function assertGpuValidationObservation(error) {
  if (error === null || error === undefined || typeof error.message !== "string" || error.message.length === 0) {
    throw new Error("GPU validation scope did not observe the deliberate validation error.");
  }
}

export async function startScene(canvas, dimensions) {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false });
  await renderer.init();
  renderer.setPixelRatio(1);
  renderer.setSize(dimensions.width, dimensions.height, false);

  const device = renderer.backend?.device;
  assertGpuValidationApi(device);
  device.pushErrorScope("validation");
  const invalidBuffer = device.createBuffer({
    label: "tn-deliberately-invalid-zero-usage-buffer",
    size: 16,
    usage: 0,
  });
  const error = await device.popErrorScope();
  invalidBuffer?.destroy?.();
  assertGpuValidationObservation(error);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14213d);
  const camera = new THREE.PerspectiveCamera(55, dimensions.width / dimensions.height, 0.1, 100);
  camera.position.z = 3.2;
  const mesh = new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.68, 0.2, 72, 12),
    new THREE.MeshBasicMaterial({ color: 0x7dd3fc }),
  );
  mesh.rotation.set(0.35, 0.25, 0.1);
  scene.add(mesh);
  function frame() {
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
  globalThis.__TN_CONFORMANCE = {
    ok: true,
    type: "gpu-validation-scope",
    detail: { observed: true, name: error.name ?? "GPUValidationError", message: error.message },
  };
  return { renderer, scene, camera, mesh, error };
}

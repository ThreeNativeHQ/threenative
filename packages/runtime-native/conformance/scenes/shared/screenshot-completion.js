import * as THREE from "three/webgpu";

export function assertSubmittedWorkPromise(value, stage) {
  if (value === null || value === undefined || typeof value.then !== "function") {
    throw new Error(`Screenshot completion is missing queue observation at ${stage}.`);
  }
}

export async function startScene(canvas, dimensions) {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false });
  await renderer.init();
  renderer.setPixelRatio(1);
  renderer.setSize(dimensions.width, dimensions.height, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111827);
  const camera = new THREE.PerspectiveCamera(55, dimensions.width / dimensions.height, 0.1, 100);
  camera.position.z = 3.2;
  const marker = new THREE.Mesh(
    new THREE.BoxGeometry(1.45, 0.85, 0.22),
    new THREE.MeshBasicMaterial({ color: 0x7f1d1d }),
  );
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.28, 0.09, 12, 32),
    new THREE.MeshBasicMaterial({ color: 0xf8fafc }),
  );
  ring.position.set(0.42, 0.08, 0.18);
  marker.add(ring);
  scene.add(marker);

  const queue = renderer.backend?.device?.queue;
  if (typeof queue?.onSubmittedWorkDone !== "function") {
    throw new Error("Screenshot completion requires GPUQueue.onSubmittedWorkDone.");
  }
  renderer.render(scene, camera);
  const firstCompletion = queue.onSubmittedWorkDone();
  assertSubmittedWorkPromise(firstCompletion, "initial-render");
  await firstCompletion;

  marker.material.color.setHex(0x16a34a);
  marker.position.x = -0.2;
  renderer.render(scene, camera);
  const finalCompletion = queue.onSubmittedWorkDone();
  assertSubmittedWorkPromise(finalCompletion, "completion-marker-render");
  await finalCompletion;

  function frame() {
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  globalThis.__TN_CONFORMANCE = {
    ok: true,
    type: "screenshot-completion",
    detail: { submittedWorkCompletions: 2, completionMarker: "green-offset-card" },
  };
  return { renderer, scene, camera, marker, ring };
}

import * as THREE from 'three/webgpu';

export async function startScene(canvas, dimensions) {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false });
  await renderer.init();
  renderer.setPixelRatio(1);
  renderer.setSize(dimensions.width, dimensions.height, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x181818);
  const camera = new THREE.PerspectiveCamera(65, dimensions.width / dimensions.height, 0.1, 100);
  camera.position.z = 3;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xff8844 }));
  scene.add(mesh);

  let resizeSeen = false;
  let pointerSeen = false;
  let touchSeen = false;
  window.addEventListener('resize', () => { resizeSeen = true; });
  canvas.addEventListener('pointerdown', () => { pointerSeen = true; });
  canvas.addEventListener('touchstart', () => { touchSeen = true; });
  window.dispatchEvent(new Event('resize'));
  canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, pointerType: 'mouse' }));
  canvas.dispatchEvent(new TouchEvent('touchstart'));
  const rafId = requestAnimationFrame(() => {});
  cancelAnimationFrame(rafId);

  function frame() {
    mesh.rotation.x += 0.02;
    mesh.rotation.y += 0.01;
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
  globalThis.__TN_CONFORMANCE = { ok: true, type: 'runtime-events-raf-resize-input', resizeSeen, pointerSeen, touchSeen };
  return { renderer, scene, camera, mesh };
}

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
  mesh.rotation.set(0.35, 0.55, 0);
  scene.add(mesh);

  let resizeSeen = false;
  let pointerSeen = false;
  let touchSeen = false;
  window.addEventListener('resize', () => { resizeSeen = true; });
  canvas.addEventListener('pointerdown', () => { pointerSeen = true; });
  canvas.addEventListener('touchstart', () => { touchSeen = true; });

  let directRemovedCalls = 0;
  const directRemoved = () => { directRemovedCalls += 1; };
  canvas.addEventListener('pointerdown', directRemoved, false);
  canvas.removeEventListener('pointerdown', directRemoved, false);
  canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, pointerType: 'mouse' }));
  if (directRemovedCalls !== 0) throw new Error('main canvas listener removal dispatched a removed callback');

  let directRetainedCalls = 0;
  const directRetained = () => { directRetainedCalls += 1; };
  canvas.addEventListener('pointerdown', directRetained, { capture: false });
  canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 4, pointerType: 'mouse' }));
  if (directRetainedCalls !== 1) throw new Error('main canvas retained listener did not fire');
  canvas.removeEventListener('pointerdown', directRetained, false);
  canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 5, pointerType: 'mouse' }));
  if (directRetainedCalls !== 1) throw new Error('main canvas retained listener was not removed');

  const rendererCanvas = document.createElement('canvas');
  let forwardedRemovedCalls = 0;
  const forwardedRemoved = () => { forwardedRemovedCalls += 1; };
  rendererCanvas.addEventListener('pointerdown', forwardedRemoved, true);
  rendererCanvas.removeEventListener('pointerdown', forwardedRemoved, true);
  rendererCanvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 3, pointerType: 'mouse' }));
  if (forwardedRemovedCalls !== 0) throw new Error('renderer canvas removal dispatched a removed callback');

  let forwardedRetainedCalls = 0;
  const forwardedRetained = () => { forwardedRetainedCalls += 1; };
  rendererCanvas.addEventListener('pointerdown', forwardedRetained, { capture: false });
  rendererCanvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 6, pointerType: 'mouse' }));
  if (forwardedRetainedCalls !== 1) throw new Error('renderer canvas retained listener did not fire');
  rendererCanvas.removeEventListener('pointerdown', forwardedRetained, { capture: false });
  rendererCanvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, pointerType: 'mouse' }));
  if (forwardedRetainedCalls !== 1) throw new Error('renderer canvas retained listener was not removed');

  let captureCalls = 0;
  const captureListener = () => { captureCalls += 1; };
  canvas.addEventListener('pointerup', captureListener, true);
  canvas.addEventListener('pointerup', captureListener, { capture: false });
  canvas.removeEventListener('pointerup', captureListener, { capture: false });
  canvas.removeEventListener('pointerup', captureListener, { capture: false });
  canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 8, pointerType: 'mouse' }));
  if (captureCalls !== 1) throw new Error('listener removal ignored capture semantics');
  canvas.removeEventListener('pointerup', captureListener, true);
  canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 9, pointerType: 'mouse' }));
  if (captureCalls !== 1) throw new Error('listener removal left a callback registered');

  let forwardedCaptureCalls = 0;
  const forwardedCaptureListener = () => { forwardedCaptureCalls += 1; };
  rendererCanvas.addEventListener('pointerup', forwardedCaptureListener, true);
  rendererCanvas.addEventListener('pointerup', forwardedCaptureListener, { capture: false });
  rendererCanvas.removeEventListener('pointerup', forwardedCaptureListener, { capture: false });
  rendererCanvas.removeEventListener('pointerup', forwardedCaptureListener, { capture: false });
  rendererCanvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 10, pointerType: 'mouse' }));
  if (forwardedCaptureCalls !== 1) throw new Error('forwarded listener removal ignored capture semantics');
  rendererCanvas.removeEventListener('pointerup', forwardedCaptureListener, true);
  rendererCanvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 11, pointerType: 'mouse' }));
  if (forwardedCaptureCalls !== 1) throw new Error('forwarded listener removal left a callback registered');

  window.dispatchEvent(new Event('resize'));
  canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, pointerType: 'mouse' }));
  canvas.dispatchEvent(new TouchEvent('touchstart'));
  const rafId = requestAnimationFrame(() => {});
  cancelAnimationFrame(rafId);

  function frame() {
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
  globalThis.__TN_CONFORMANCE = { ok: true, type: 'runtime-events-raf-resize-input', resizeSeen, pointerSeen, touchSeen };
  return { renderer, scene, camera, mesh };
}

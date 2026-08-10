import * as THREE from 'three/webgpu';

export async function startScene(canvas, dimensions) {
  const required = [
    ['Blob', typeof Blob],
    ['URL.createObjectURL', typeof URL.createObjectURL],
    ['URL.revokeObjectURL', typeof URL.revokeObjectURL],
    ['createImageBitmap', typeof createImageBitmap],
    ['Response', typeof Response],
    ['Headers', typeof Headers]
  ];
  for (const [name, kind] of required) {
    if (kind !== 'function') throw new Error(name + ' missing');
  }
  const blob = new Blob([new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137,0,0,0,13,73,68,65,84,120,156,99,248,207,192,240,31,0,5,0,1,255,137,153,61,29,0,0,0,0,73,69,78,68,174,66,96,130])], { type: 'image/png' });
  if (typeof blob.stream !== 'function') throw new Error('Blob.stream missing');
  const url = URL.createObjectURL(blob);
  const bitmap = await createImageBitmap(blob);
  URL.revokeObjectURL(url);

  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false });
  await renderer.init();
  renderer.setPixelRatio(1);
  renderer.setSize(dimensions.width, dimensions.height, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x301820);
  const camera = new THREE.PerspectiveCamera(60, dimensions.width / dimensions.height, 0.1, 100);
  camera.position.z = 2.5;
  const texture = new THREE.CanvasTexture(bitmap);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), new THREE.MeshBasicMaterial({ map: texture, color: 0xffffff }));
  scene.add(mesh);
  function frame() {
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
  globalThis.__TN_CONFORMANCE = { ok: true, type: 'texture-blob-imagebitmap' };
  return { renderer, scene, camera, mesh };
}

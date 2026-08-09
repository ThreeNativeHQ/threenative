import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export async function startScene(canvas, dimensions) {
  if (!THREE.Scene || !THREE.WebGPURenderer || !GLTFLoader) throw new Error('bare three/three-webgpu/addon imports failed');
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false });
  await renderer.init();
  renderer.setPixelRatio(1);
  renderer.setSize(dimensions.width, dimensions.height, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x202030);
  const camera = new THREE.PerspectiveCamera(70, dimensions.width / dimensions.height, 0.1, 100);
  camera.position.z = 2.4;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.7, 32, 16), new THREE.MeshBasicMaterial({ color: 0x66cc88 }));
  scene.add(mesh);
  function frame() {
    mesh.rotation.y += 0.02;
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
  globalThis.__TN_CONFORMANCE = { ok: true, type: 'module-resolution', threeRevision: THREE.REVISION };
  return { renderer, scene, camera, mesh };
}

import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export async function startScene(canvas, dimensions) {
  const assetBase = globalThis.__TN_ASSET_BASE__;
  if (typeof assetBase !== 'string') throw new Error('__TN_ASSET_BASE__ missing');
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false });
  await renderer.init();
  renderer.setPixelRatio(1);
  renderer.setSize(dimensions.width, dimensions.height, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x18202f);
  const camera = new THREE.PerspectiveCamera(55, dimensions.width / dimensions.height, 0.1, 100);
  camera.position.set(0, 0.55, 3.2);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x202040, 2));
  const key = new THREE.DirectionalLight(0xffffff, 3);
  key.position.set(3, 4, 5);
  scene.add(key);

  const manager = new THREE.LoadingManager();
  const events = [];
  manager.onStart = (url) => events.push(['start', url]);
  manager.onLoad = () => events.push(['load']);
  manager.onError = (url) => { throw new Error('GLTF manager error: ' + url); };

  const controller = new AbortController();
  const probe = new Request(assetBase + 'examples/assets/DamagedHelmet.glb', { signal: controller.signal });
  const response = await fetch(probe);
  if (!response.ok) throw new Error('GLB fetch failed: ' + response.status);
  if (!response.headers || typeof response.headers.get !== 'function') throw new Error('Response.headers.get missing');
  await response.arrayBuffer();

  const loader = new GLTFLoader(manager);
  const gltf = await loader.loadAsync(assetBase + 'examples/assets/DamagedHelmet.glb');
  gltf.scene.name = 'upstream-GLTFLoader-DamagedHelmet-GLB';
  gltf.scene.scale.setScalar(1.7);
  gltf.scene.position.set(0, -0.55, 0);
  scene.add(gltf.scene);

  function frame() {
    gltf.scene.rotation.y += 0.01;
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
  globalThis.__TN_CONFORMANCE = { ok: true, type: 'gltf-glb', loadingManagerEvents: events.length };
  return { renderer, scene, camera, gltf };
}

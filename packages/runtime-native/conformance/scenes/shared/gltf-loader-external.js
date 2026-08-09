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
  scene.background = new THREE.Color(0x101820);
  const camera = new THREE.PerspectiveCamera(55, dimensions.width / dimensions.height, 0.1, 100);
  camera.position.set(0, 0.55, 3.4);
  scene.add(new THREE.AmbientLight(0xffffff, 1.6));
  const light = new THREE.DirectionalLight(0xffffff, 2.5);
  light.position.set(2, 3, 4);
  scene.add(light);

  const manager = new THREE.LoadingManager();
  const loaded = [];
  manager.onLoad = () => loaded.push('done');
  const loader = new GLTFLoader(manager);
  const gltf = await loader.loadAsync(assetBase + 'examples/assets/DamagedHelmet/glTF/DamagedHelmet.gltf');
  gltf.scene.name = 'upstream-GLTFLoader-DamagedHelmet-external-gltf-bin-jpg';
  gltf.scene.scale.setScalar(1.65);
  gltf.scene.position.y = -0.55;
  scene.add(gltf.scene);

  function frame() {
    gltf.scene.rotation.y += 0.012;
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
  globalThis.__TN_CONFORMANCE = { ok: true, type: 'gltf-external', loadingManagerComplete: loaded.length > 0 };
  return { renderer, scene, camera, gltf };
}

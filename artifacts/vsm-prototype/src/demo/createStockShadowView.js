import { createAvenueScene } from './createAvenueScene.js';

export function createStockShadowView(THREE, canvas, {
  width,
  height,
  cameraPosition = new THREE.Vector3(57, 34, 72),
} = {}) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.03;
  if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;

  const camera = new THREE.PerspectiveCamera(46, width / height, 0.5, 520);
  camera.position.copy(cameraPosition);

  const materialCache = new Map();
  const materialFactory = (name, color, roughness, metalness) => {
    if (!materialCache.has(name)) {
      materialCache.set(name, new THREE.MeshStandardMaterial({
        name: `Stock-${name}`,
        color,
        roughness,
        metalness,
      }));
    }
    return materialCache.get(name);
  };

  const result = createAvenueScene(THREE, { materialFactory, stock: true });
  const { scene } = result;
  camera.lookAt(result.cameraTarget);
  camera.updateMatrixWorld(true);

  const hemisphere = new THREE.HemisphereLight(0x9cb8d6, 0x312a25, 1.85);
  scene.add(hemisphere);

  const sun = new THREE.DirectionalLight(0xffedca, 3.4);
  sun.name = 'ConventionalDirectionalShadow';
  sun.position.set(116, 205, 74);
  sun.target.position.set(0, 0, -70);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -69;
  sun.shadow.camera.right = 69;
  sun.shadow.camera.top = 69;
  sun.shadow.camera.bottom = -69;
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 390;
  sun.shadow.bias = -0.00035;
  sun.shadow.normalBias = 0.08;
  sun.shadow.radius = 2;
  scene.add(sun, sun.target);

  result.scene.traverse((object) => {
    if (!object.isMesh) return;
    object.receiveShadow = true;
    if (object.name !== 'GroundReceiver' && object.name !== 'CentralAvenueReceiver') {
      object.castShadow = true;
    }
  });

  const resize = (nextWidth, nextHeight) => {
    renderer.setSize(nextWidth, nextHeight, false);
    camera.aspect = nextWidth / nextHeight;
    camera.updateProjectionMatrix();
  };

  const render = () => renderer.render(scene, camera);
  const dispose = () => {
    for (const material of materialCache.values()) material.dispose();
    renderer.dispose();
  };

  return { renderer, camera, scene, sun, render, resize, dispose, ...result };
}

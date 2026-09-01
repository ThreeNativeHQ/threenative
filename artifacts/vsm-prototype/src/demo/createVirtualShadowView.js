import { VirtualShadowMap } from '../render/VirtualShadowMap.js';
import { createVirtualShadowMaterial } from '../render/VirtualShadowMaterial.js';
import { createAvenueScene } from './createAvenueScene.js';

export function createVirtualShadowView(THREE, canvas, {
  width,
  height,
  mode = 'comparison',
  cameraPosition = new THREE.Vector3(57, 34, 72),
  renderBudget = 32,
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
  renderer.autoClear = true;
  renderer.shadowMap.enabled = false;

  const camera = new THREE.PerspectiveCamera(46, width / height, 0.5, 520);
  camera.position.copy(cameraPosition);
  const scene = new THREE.Scene();

  const lightDirection = new THREE.Vector3(0.56, 1, 0.36).normalize();
  const virtualShadowMap = new VirtualShadowMap(THREE, renderer, scene, {
    camera,
    lightDirection,
    pageSize: 128,
    virtualPagesPerAxis: 8,
    atlasPagesPerAxis: 13,
    clipExtents: [20, 46, 98, 198],
    selectionGuard: 0.9,
    renderBudget,
    receiverPlaneY: 0,
    demandColumns: 19,
    demandRows: 13,
    demandGuardBand: 1,
    lightDistance: 255,
    lightNear: 1,
    lightFar: 560,
    shadowBias: 0.0008,
    normalBias: 0.095,
    filterRadius: 1.15,
    shadowStrength: 0.9,
    sunColor: 0xffedc8,
    skyColor: 0x83a2c5,
    groundColor: 0x342c28,
    ambientIntensity: 0.38,
    sunIntensity: 2.65,
    fogDensity: 0.0058,
    fogColor: 0x8da2b4,
  });

  const materialCache = new Map();
  const materialFactory = (name, color, roughness, metalness, materialVariation) => {
    if (!materialCache.has(name)) {
      materialCache.set(name, createVirtualShadowMaterial(
        THREE,
        virtualShadowMap.sharedUniforms,
        { color, roughness, metalness, materialVariation },
      ));
    }
    return materialCache.get(name);
  };

  const result = createAvenueScene(THREE, { scene, materialFactory, stock: false });
  camera.lookAt(result.cameraTarget);
  camera.updateMatrixWorld(true);
  for (const caster of result.casters) virtualShadowMap.trackCaster(caster);

  virtualShadowMap.setDebugMode(mode === 'debug' ? 'pages' : mode === 'invalidation' ? 'residency' : 'normal');

  const resize = (nextWidth, nextHeight) => {
    renderer.setSize(nextWidth, nextHeight, false);
    camera.aspect = nextWidth / nextHeight;
    camera.updateProjectionMatrix();
  };

  const render = (frame) => {
    const stats = virtualShadowMap.update(frame);
    renderer.setRenderTarget(null);
    renderer.setViewport(0, 0, canvas.width, canvas.height);
    renderer.setScissorTest(false);
    renderer.render(scene, camera);
    return stats;
  };

  const dispose = () => {
    virtualShadowMap.dispose();
    for (const material of materialCache.values()) material.dispose();
    renderer.dispose();
  };

  const getStats = () => virtualShadowMap.getStats();

  return {
    renderer,
    camera,
    scene,
    virtualShadowMap,
    render,
    resize,
    dispose,
    getStats,
    ...result,
  };
}

// Numeric shadow-footprint probe: one sphere over a plane, top-down orthographic camera.
//
// Renders the virtual-shadow view in `shadow` debug mode (colour = shadow term) and a stock
// PCF shadow-map control with the same camera, then reads both frames back and reports the
// dark-pixel centroid of each against the analytic footprint centre
// `C - W * (C.y / W.y)` of the sphere. A correct virtual lookup lands within a page texel of
// both; a mirrored or offset page lands a page away.
import { VirtualShadowMap } from '../render/VirtualShadowMap.js';
import { createVirtualShadowMaterial } from '../render/VirtualShadowMaterial.js';

const SIZE = 800;
const HALF_EXTENT = 20;
const DARK_THRESHOLD = 96;

function centroidOfDark(pixels, width, height) {
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (pixels[offset] < DARK_THRESHOLD) {
        count += 1;
        sumX += x;
        sumY += y;
      }
    }
  }
  if (count === 0) return { count, x: NaN, z: NaN };
  // Camera looks down -Y with up = -Z: pixel x maps to +x, pixel row 0 is the far (-z) edge.
  const px = sumX / count;
  const py = sumY / count;
  return {
    count,
    x: -HALF_EXTENT + ((px + 0.5) / width) * HALF_EXTENT * 2,
    z: -HALF_EXTENT + ((py + 0.5) / height) * HALF_EXTENT * 2,
  };
}

function makeTopCamera(THREE) {
  const camera = new THREE.OrthographicCamera(
    -HALF_EXTENT, HALF_EXTENT, HALF_EXTENT, -HALF_EXTENT, 1, 200,
  );
  camera.position.set(0, 60, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  return camera;
}

function readTarget(THREE, renderer, target) {
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, pixels);
  // readRenderTargetPixels returns rows bottom-up; flip so row 0 is the top of the frame.
  const flipped = new Uint8Array(pixels.length);
  const rowBytes = SIZE * 4;
  for (let row = 0; row < SIZE; row += 1) {
    flipped.set(pixels.subarray(row * rowBytes, (row + 1) * rowBytes), (SIZE - 1 - row) * rowBytes);
  }
  return flipped;
}

export async function runProbe(THREE, { sphereCenter = { x: 6, y: 5, z: 2 }, radius = 2 } = {}) {
  window.__TN_VSM_READY__ = false;
  window.__TN_VSM_ERROR__ = null;
  const lightDirection = new THREE.Vector3(0.56, 1, 0.36).normalize();
  const expected = {
    x: sphereCenter.x - (lightDirection.x / lightDirection.y) * sphereCenter.y,
    z: sphereCenter.z - (lightDirection.z / lightDirection.y) * sphereCenter.y,
  };

  try {
    // Virtual view.
    const virtualCanvas = document.querySelector('#virtual-canvas');
    const renderer = new THREE.WebGLRenderer({ canvas: virtualCanvas, antialias: false });
    renderer.setPixelRatio(1);
    renderer.setSize(SIZE, SIZE, false);
    renderer.shadowMap.enabled = false;
    const scene = new THREE.Scene();
    const camera = makeTopCamera(THREE);
    const vsm = new VirtualShadowMap(THREE, renderer, scene, {
      camera,
      lightDirection,
      clipExtents: [20, 46, 98, 198],
      renderBudget: 64,
      fogDensity: 0,
      shadowStrength: 1,
    });
    const material = createVirtualShadowMaterial(THREE, vsm.sharedUniforms, { color: 0xffffff });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), material);
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 24), material);
    sphere.position.set(sphereCenter.x, sphereCenter.y, sphereCenter.z);
    scene.add(sphere);
    vsm.trackCaster(sphere);
    vsm.setDebugMode('shadow');

    const target = new THREE.WebGLRenderTarget(SIZE, SIZE, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
    });
    let stats = null;
    let settled = 0;
    for (let frame = 1; frame <= 60 && settled < 3; frame += 1) {
      stats = vsm.update(frame);
      settled = stats.dirtyResident === 0 && stats.rendered === 0 ? settled + 1 : 0;
      renderer.setRenderTarget(target);
      renderer.setViewport(0, 0, SIZE, SIZE);
      renderer.setScissorTest(false);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    }
    const virtualPixels = readTarget(THREE, renderer, target);
    const virtual = centroidOfDark(virtualPixels, SIZE, SIZE);

    // Stock control: same camera, one shadow-casting directional light, no ambient.
    const stockCanvas = document.querySelector('#stock-canvas');
    const stockRenderer = new THREE.WebGLRenderer({ canvas: stockCanvas, antialias: false });
    stockRenderer.setPixelRatio(1);
    stockRenderer.setSize(SIZE, SIZE, false);
    stockRenderer.shadowMap.enabled = true;
    stockRenderer.shadowMap.type = THREE.PCFShadowMap;
    const stockScene = new THREE.Scene();
    const stockMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const stockGround = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), stockMaterial);
    stockGround.rotation.x = -Math.PI / 2;
    stockGround.receiveShadow = true;
    stockScene.add(stockGround);
    const stockSphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 24), stockMaterial);
    stockSphere.position.copy(sphere.position);
    stockSphere.castShadow = true;
    stockScene.add(stockSphere);
    const sun = new THREE.DirectionalLight(0xffffff, 3);
    sun.position.copy(lightDirection).multiplyScalar(100);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -30;
    sun.shadow.camera.right = 30;
    sun.shadow.camera.top = 30;
    sun.shadow.camera.bottom = -30;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 250;
    sun.shadow.bias = -0.0005;
    stockScene.add(sun, sun.target);
    const stockTarget = new THREE.WebGLRenderTarget(SIZE, SIZE, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
    });
    stockRenderer.setRenderTarget(stockTarget);
    stockRenderer.render(stockScene, camera);
    stockRenderer.setRenderTarget(null);
    stockRenderer.render(stockScene, camera);
    const stockPixels = readTarget(THREE, stockRenderer, stockTarget);
    const stock = centroidOfDark(stockPixels, SIZE, SIZE);

    let differing = 0;
    for (let index = 0; index < virtualPixels.length; index += 4) {
      const a = virtualPixels[index] < DARK_THRESHOLD;
      const b = stockPixels[index] < DARK_THRESHOLD;
      if (a !== b) differing += 1;
    }

    const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    const result = {
      probe: 'sphere-footprint',
      sphereCenter,
      radius,
      expected,
      virtual,
      stock,
      virtualToExpected: distance(virtual, expected),
      stockToExpected: distance(stock, expected),
      virtualToStock: distance(virtual, stock),
      changedPixelRatio: differing / (SIZE * SIZE),
      darkPixelRatio: virtual.count / Math.max(stock.count, 1),
      level0PageWorldSize: vsm.clipmap.pageWorldSize(0),
      stats,
    };
    window.__TN_VSM_DEBUG__ = result;
    window.__TN_VSM_READY__ = true;
    document.body.dataset.ready = 'true';
    return result;
  } catch (error) {
    window.__TN_VSM_ERROR__ = String(error.stack || error);
    document.body.dataset.error = 'true';
    throw error;
  }
}

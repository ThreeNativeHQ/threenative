import * as THREE from "three/webgpu";

export async function startScene(canvas, dimensions) {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false });
  await renderer.init();
  renderer.setPixelRatio(1);
  renderer.setSize(dimensions.width, dimensions.height, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x18202f);

  const camera = new THREE.PerspectiveCamera(55, dimensions.width / dimensions.height, 0.1, 100);
  camera.position.set(0, 0.25, 3.2);

  const gradientMap = new THREE.DataTexture(
    new Uint8Array([100, 100, 100, 255, 190, 190, 190, 255, 255, 255, 255, 255]),
    3,
    1,
    THREE.RGBAFormat,
  );
  gradientMap.minFilter = THREE.NearestFilter;
  gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.needsUpdate = true;

  const material = new THREE.MeshToonMaterial({ color: 0xf29a38, gradientMap });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.9, 32, 20), material);
  scene.add(mesh);

  const light = new THREE.DirectionalLight(0xffffff, 3);
  light.position.set(-3, 4, 5);
  scene.add(light);

  function frame() {
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
  globalThis.__TN_CONFORMANCE = { ok: true, type: "mesh-toon-material-gradientmap" };
  return { renderer, scene, camera, mesh, gradientMap, light };
}

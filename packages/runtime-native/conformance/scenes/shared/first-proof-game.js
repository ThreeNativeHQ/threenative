import * as THREE from 'three/webgpu';

export async function startFirstProofGame(canvas, dimensions) {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false });
  await renderer.init();
  renderer.setPixelRatio(1);
  renderer.setSize(dimensions.width, dimensions.height, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111827);

  const camera = new THREE.PerspectiveCamera(70, dimensions.width / dimensions.height, 0.1, 100);
  camera.position.set(0, 0, 3);

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({ color: 0x4488ff, roughness: 0.45, metalness: 0.05 });
  const cube = new THREE.Mesh(geometry, material);
  scene.add(cube);

  const light = new THREE.DirectionalLight(0xffffff, 3);
  light.position.set(3, 4, 5);
  scene.add(light);

  function frame() {
    cube.rotation.x += 0.01;
    cube.rotation.y += 0.015;
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
  return { renderer, scene, camera, cube };
}

export const startScene = startFirstProofGame;

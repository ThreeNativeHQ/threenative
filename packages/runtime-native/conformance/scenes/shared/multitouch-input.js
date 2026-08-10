import { InputMap } from "../../../../core/src/input.js";
import * as THREE from "three/webgpu";

export async function startScene(canvas, dimensions) {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false });
  await renderer.init();
  renderer.setPixelRatio(1);
  renderer.setSize(dimensions.width, dimensions.height, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101827);
  const camera = new THREE.OrthographicCamera(-3, 3, 2, -2, 0.1, 100);
  camera.position.z = 10;

  const ground = new THREE.Mesh(
    new THREE.BoxGeometry(5.5, 0.18, 0.3),
    new THREE.MeshBasicMaterial({ color: 0x334155 }),
  );
  ground.position.y = -1;
  scene.add(ground);

  const player = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.55, 0.35),
    new THREE.MeshBasicMaterial({ color: 0x67e8f9 }),
  );
  player.position.y = -0.7;
  scene.add(player);

  const input = new InputMap({}, globalThis, canvas, () => []);
  const state = { leftGround: false, moved: false, simultaneous: false };
  globalThis.__TN_MULTITOUCH_INPUT_READY__ = true;

  function frame() {
    const pointers = [...input.raw.pointers.values()];
    const halfWidth = dimensions.width / 2;
    const stick = pointers.some((pointer) => pointer.position.x < halfWidth);
    const jump = pointers.some((pointer) => pointer.position.x >= halfWidth);
    if (stick) {
      player.position.x = Math.min(2.4, player.position.x + 0.025);
      state.moved = true;
    }
    if (jump) {
      player.position.y = -0.35;
      state.leftGround = true;
    }
    // Latches only when both halves are held in the *same* frame. Two sequential one-finger
    // touches set `moved` and `leftGround` but never this, which is what the proof checks.
    if (stick && jump) state.simultaneous = true;
    globalThis.__TN_MULTITOUCH_PROOF__ = {
      leftGround: state.leftGround,
      moved: state.moved,
      pointers: pointers.length,
      simultaneous: state.simultaneous,
    };
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  frame();
  return { renderer, scene, camera, player };
}

import { THREE, assertCondition, startVisualScene } from "./scene-support.js";

export function assertOffscreenPixels(pixels, width, height) {
  assertCondition(ArrayBuffer.isView(pixels), "offscreen screenshot must be a typed array");
  assertCondition(pixels.length === width * height * 4, "offscreen screenshot size mismatch");
  const first = pixels.slice(0, 4).join(",");
  let distinct = false;
  for (let offset = 4; offset < pixels.length; offset += 4) {
    if (pixels.slice(offset, offset + 4).join(",") !== first) {
      distinct = true;
      break;
    }
  }
  assertCondition(distinct, "offscreen screenshot is a single color");
}

export function startScene(canvas, dimensions) {
  return startVisualScene(
    canvas,
    dimensions,
    "offscreen-screenshot",
    async ({ renderer, scene }) => {
      assertCondition(
        typeof renderer.readRenderTargetPixelsAsync === "function",
        "WebGPU render-target readback is unavailable",
      );
      const width = 64;
      const height = 64;
      const target = new THREE.RenderTarget(width, height);
      const captureScene = new THREE.Scene();
      captureScene.background = new THREE.Color(0x1a365d);
      const captureCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 4);
      captureCamera.position.z = 2;
      const left = new THREE.Mesh(
        new THREE.PlaneGeometry(0.8, 1.4),
        new THREE.MeshBasicMaterial({ color: 0xf56565 }),
      );
      left.position.x = -0.45;
      const right = new THREE.Mesh(
        new THREE.CircleGeometry(0.52, 32),
        new THREE.MeshBasicMaterial({ color: 0x68d391 }),
      );
      right.position.x = 0.45;
      captureScene.add(left, right);

      renderer.setRenderTarget(target);
      renderer.render(captureScene, captureCamera);
      const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height);
      renderer.setRenderTarget(null);
      assertOffscreenPixels(pixels, width, height);

      const preview = new THREE.Mesh(
        new THREE.PlaneGeometry(2.35, 2.35),
        new THREE.MeshBasicMaterial({ map: target.texture }),
      );
      scene.add(preview);
      return { preview, target, detail: { width, height, byteLength: pixels.byteLength } };
    },
  );
}

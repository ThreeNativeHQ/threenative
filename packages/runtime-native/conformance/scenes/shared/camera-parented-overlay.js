import {
  OVERLAY_ANCHOR,
  assertAnchorHeld,
  assertRenderedSize,
  overlayRenderPlan,
} from "../../overlay-anchor.mjs";
import { THREE, startVisualScene } from "./scene-support.js";

// PRD-166 phase 1: this row died on Android as an unattributed SIGABRT that the harness
// reported as "exited before the conformance marker". These lines form a ladder in logcat so a
// dead run says how far it walked: module loaded, scene entered, each viewport reached, each
// viewport passed. A run whose last line is the one before a step names that step as the death.
const trace = (stage, detail = {}) =>
  console.info(`TN_PRD166_TRACE:${JSON.stringify({ stage, ...detail })}`);

trace("module-loaded");

const DEPTH = 1.4;

function layoutInPixelSpace(camera, root, overlay, size) {
  const worldHeight = 2 * DEPTH * Math.tan((camera.fov * Math.PI) / 360);
  const pixel = worldHeight / size.height;
  camera.aspect = size.width / size.height;
  camera.updateProjectionMatrix();
  root.scale.setScalar(pixel);
  root.position.set((-size.width * pixel) / 2, (size.height * pixel) / 2, -DEPTH);
  overlay.position.set(
    OVERLAY_ANCHOR.x + OVERLAY_ANCHOR.width / 2,
    -(OVERLAY_ANCHOR.y + OVERLAY_ANCHOR.height / 2),
    0,
  );
  camera.updateMatrixWorld(true);
}

function screenPosition(camera, object, size) {
  const point = object.getWorldPosition(new THREE.Vector3()).project(camera);
  return { x: ((point.x + 1) / 2) * size.width, y: ((1 - point.y) / 2) * size.height };
}

export function startScene(canvas, dimensions) {
  trace("start-scene");
  return startVisualScene(
    canvas,
    dimensions,
    "camera-parented-overlay",
    ({ renderer, scene, camera }) => {
      trace("build-entered");
      const world = new THREE.Mesh(
        new THREE.TorusKnotGeometry(0.62, 0.2, 96, 16),
        new THREE.MeshStandardMaterial({ color: 0x718096, roughness: 0.5 }),
      );
      world.rotation.set(0.3, 0.4, 0);
      const root = new THREE.Group();
      const overlay = new THREE.Mesh(
        new THREE.PlaneGeometry(OVERLAY_ANCHOR.width, OVERLAY_ANCHOR.height),
        new THREE.MeshBasicMaterial({ color: 0x48bb78, depthTest: false }),
      );
      overlay.renderOrder = 10;
      root.add(overlay);
      camera.add(root);
      scene.add(camera, world, new THREE.DirectionalLight(0xffffff, 3));

      // Each viewport resizes the real renderer and renders a frame. The observation comes
      // from the drawing buffer, so removing the resize fails the row rather than passing it.
      const plan = overlayRenderPlan(dimensions);
      for (let index = 0; index < plan.length; index += 1) {
        const size = plan[index];
        trace("viewport-begin", { height: size.height, index, width: size.width });
        renderer.setSize(size.width, size.height, false);
        // Splitting the two native calls a resize iteration makes: on the emulator the process
        // aborts inside this window with no output of its own, and "between begin and passed"
        // is not enough to hand the engine lane a named call.
        trace("set-size-returned", { height: size.height, index, width: size.width });
        layoutInPixelSpace(camera, root, overlay, size);
        renderer.render(scene, camera);
        trace("render-returned", { height: size.height, index, width: size.width });
        assertRenderedSize(size, { height: canvas.height, width: canvas.width });
        assertAnchorHeld(size, screenPosition(camera, overlay, size));
        trace("viewport-passed", { height: size.height, index, width: size.width });
      }
      return { overlay, root, world };
    },
  );
}

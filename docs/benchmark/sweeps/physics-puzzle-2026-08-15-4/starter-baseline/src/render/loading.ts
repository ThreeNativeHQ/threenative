import {
  type Camera,
  Mesh,
  MeshBasicMaterial,
  type OrthographicCamera,
  PlaneGeometry,
  type Scene,
} from "three";
import { palette } from "./palette.js";

/**
 * What the framework hands a loading screen. Structural on purpose: nothing under `src/render/`
 * imports the framework, and `ctx` already satisfies this shape.
 */
export interface LoadingHost {
  readonly camera: Camera;
  readonly scene: Scene;
  readonly canvasLayer: {
    readonly camera: OrthographicCamera;
    readonly scene: Scene;
    opaque: boolean;
  };
  readonly renderer: { compileAsync(scene: Scene, camera: Camera): Promise<void> };
  readonly startup: { readonly progress: number; whenReady(): Promise<void> };
}

/**
 * Draws the loading screen in the framework's pixel-sized canvas layer. Colours, layout, and the
 * shape of the bar live here in generated source, so they remain the game's to change or delete.
 */
export function createLoadingScreen(host: LoadingHost) {
  const layer = host.canvasLayer;
  const camera = layer.camera;
  const cover = (color: number, renderOrder: number) => {
    const mesh = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({ color, depthTest: false, depthWrite: false }),
    );
    mesh.frustumCulled = false;
    mesh.renderOrder = renderOrder;
    layer.scene.add(mesh);
    return mesh;
  };
  const backdrop = cover(palette.skyLow, 0);
  const track = cover(palette.skyHigh, 1);
  const fill = cover(palette.accent, 2);
  const parts = [backdrop, track, fill];
  layer.opaque = true;

  let width = 0;
  let height = 0;
  let lastProgress = 0;

  const layout = (): void => {
    const nextWidth = camera.right - camera.left;
    const nextHeight = camera.top - camera.bottom;
    width = Number.isFinite(nextWidth) && nextWidth > 0 ? nextWidth : 1;
    height = Number.isFinite(nextHeight) && nextHeight > 0 ? nextHeight : 1;
    backdrop.scale.set(width, height, 1);
    track.scale.set(width * 0.5, height * 0.012, 1);
    track.position.set(0, -height * 0.05, 0);
    fill.position.set(0, -height * 0.05, 0);
  };

  const setProgress = (progress: number): void => {
    // `Math.max(0, Math.min(1, NaN))` is NaN, so non-finite progress means no progress.
    lastProgress = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
    const full = width * 0.5;
    const barWidth = Math.max(full * 0.002, full * lastProgress);
    fill.scale.set(barWidth, height * 0.012, 1);
    fill.position.x = -full / 2 + barWidth / 2;
  };

  let laidOutWidth = camera.right - camera.left;
  let laidOutHeight = camera.top - camera.bottom;
  layout();
  setProgress(0);

  let done = false;
  const finish = (): void => {
    if (done) return;
    done = true;
    for (const mesh of parts) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    layer.opaque = false;
  };

  void (async () => {
    await host.startup.whenReady();
    // Compile the collapsed world's pipelines while the opaque canvas layer still covers it.
    await host.renderer.compileAsync(host.scene, host.camera).catch(() => undefined);
    finish();
  })();

  return {
    update(): void {
      if (done) return;
      const nextWidth = camera.right - camera.left;
      const nextHeight = camera.top - camera.bottom;
      if (nextWidth !== laidOutWidth || nextHeight !== laidOutHeight) {
        laidOutWidth = nextWidth;
        laidOutHeight = nextHeight;
        layout();
        setProgress(lastProgress);
      }
      setProgress(host.startup.progress);
    },
    finish,
  };
}

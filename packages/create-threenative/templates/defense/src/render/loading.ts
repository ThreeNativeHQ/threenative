import {
  type Camera,
  Mesh,
  MeshBasicMaterial,
  type OrthographicCamera,
  PlaneGeometry,
  type Scene,
} from "three";
import { palette } from "./palette.js";

export interface ILoadingHost {
  readonly camera: Camera;
  readonly canvasLayer: {
    readonly camera: OrthographicCamera;
    readonly scene: Scene;
    opaque: boolean;
  };
  readonly renderer: { compileAsync(scene: Scene, camera: Camera): Promise<void> };
  readonly scene: Scene;
  readonly startup: { readonly progress: number; whenReady(): Promise<void> };
}

export function createLoadingScreen(host: ILoadingHost) {
  const layer = host.canvasLayer;
  const camera = layer.camera;
  const cover = (color: number, order: number) => {
    const mesh = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({ color, depthTest: false, depthWrite: false }),
    );
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    layer.scene.add(mesh);
    return mesh;
  };
  const backdrop = cover(palette.skyHigh, 0);
  const track = cover(palette.route, 1);
  const fill = cover(palette.accent, 2);
  const parts = [backdrop, track, fill];
  layer.opaque = true;
  let width = 1;
  let height = 1;
  let lastProgress = 0;
  const layout = (): void => {
    width = Math.max(1, camera.right - camera.left);
    height = Math.max(1, camera.top - camera.bottom);
    backdrop.scale.set(width, height, 1);
    track.scale.set(width * 0.5, height * 0.012, 1);
    track.position.set(0, -height * 0.05, 0);
  };
  const setProgress = (progress: number): void => {
    lastProgress = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
    const full = width * 0.5;
    const barWidth = Math.max(full * 0.002, full * lastProgress);
    fill.scale.set(barWidth, height * 0.012, 1);
    fill.position.set(-full / 2 + barWidth / 2, -height * 0.05, 0);
  };
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
    await host.renderer.compileAsync(host.scene, host.camera).catch(() => undefined);
    finish();
  })();
  return {
    finish,
    update(): void {
      if (done) return;
      const nextWidth = camera.right - camera.left;
      const nextHeight = camera.top - camera.bottom;
      if (nextWidth !== width || nextHeight !== height) {
        layout();
        setProgress(lastProgress);
      }
      setProgress(host.startup.progress);
    },
  };
}

import {
  type Camera,
  Mesh,
  MeshBasicMaterial,
  type OrthographicCamera,
  PlaneGeometry,
  type Scene,
} from "three";
import { palette } from "./palette.js";

export interface LoadingHost {
  readonly camera: Camera;
  readonly canvasLayer: {
    readonly camera: OrthographicCamera;
    readonly scene: Scene;
    opaque: boolean;
  };
  readonly renderer: { compileAsync(scene: Scene, camera: Camera): Promise<void> };
  readonly startup: { readonly progress: number; whenReady(): Promise<void> };
}

export function createLoadingScreen(host: LoadingHost) {
  const layer = host.canvasLayer;
  const camera = layer.camera;
  const cover = (color: number, order: number): Mesh => {
    const mesh = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({ color, depthTest: false, depthWrite: false }),
    );
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    layer.scene.add(mesh);
    return mesh;
  };
  const backdrop = cover(palette.skyLow, 0);
  const track = cover(palette.skyHigh, 1);
  const fill = cover(palette.accent, 2);
  layer.opaque = true;
  let width = 1;
  let height = 1;
  let progress = 0;

  const layout = (): void => {
    width = Math.max(1, camera.right - camera.left);
    height = Math.max(1, camera.top - camera.bottom);
    backdrop.scale.set(width, height, 1);
    track.scale.set(width * 0.48, height * 0.012, 1);
    track.position.set(0, -height * 0.06, 0);
  };
  const setProgress = (value: number): void => {
    progress = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    const full = width * 0.48;
    const bar = Math.max(full * 0.002, full * progress);
    fill.scale.set(bar, height * 0.012, 1);
    fill.position.set(-full / 2 + bar / 2, -height * 0.06, 0);
  };
  layout();
  setProgress(0);
  let done = false;
  const finish = (): void => {
    if (done) return;
    done = true;
    for (const mesh of [backdrop, track, fill]) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      if (!Array.isArray(mesh.material)) mesh.material.dispose();
    }
    layer.opaque = false;
  };
  void (async () => {
    await host.startup.whenReady();
    await host.renderer.compileAsync(host.canvasLayer.scene, host.camera).catch(() => undefined);
    finish();
  })();

  return {
    finish,
    update(): void {
      if (done) return;
      const nextWidth = camera.right - camera.left;
      const nextHeight = camera.top - camera.bottom;
      if (nextWidth !== width || nextHeight !== height) layout();
      setProgress(host.startup.progress);
    },
  };
}

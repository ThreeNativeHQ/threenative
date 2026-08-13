import {
  type Camera,
  Mesh,
  MeshBasicMaterial,
  type OrthographicCamera,
  PlaneGeometry,
  type Scene,
} from "three";
import { palette } from "./palette.js";

interface LoadingHost {
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

export function createLoadingScreen(host: LoadingHost) {
  const layer = host.canvasLayer;
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
  const parts = [backdrop, track, fill];
  layer.opaque = true;
  let width = 1;
  let height = 1;
  let lastProgress = 0;

  const layout = (): void => {
    width = Math.max(1, layer.camera.right - layer.camera.left);
    height = Math.max(1, layer.camera.top - layer.camera.bottom);
    backdrop.scale.set(width, height, 1);
    track.scale.set(width * 0.5, height * 0.012, 1);
    track.position.set(0, -height * 0.05, 0);
  };
  const progress = (value: number): void => {
    lastProgress = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    const full = width * 0.5;
    const bar = Math.max(full * 0.002, full * lastProgress);
    fill.scale.set(bar, height * 0.012, 1);
    fill.position.set(-full / 2 + bar / 2, -height * 0.05, 0);
  };
  layout();
  progress(0);
  let done = false;
  const finish = (): void => {
    if (done) return;
    done = true;
    for (const mesh of parts) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) {
        for (const material of mesh.material) material.dispose();
      } else {
        mesh.material.dispose();
      }
    }
    layer.opaque = false;
  };
  void (async () => {
    await host.startup.whenReady();
    // Keep shader warm-up off the reveal path: custom TSL post graphs may never settle under
    // SwiftShader, while the scene itself is already safe to show after the startup verdict.
    void host.renderer.compileAsync(host.scene, host.camera).catch(() => undefined);
    finish();
  })();
  return {
    update(): void {
      if (done) return;
      layout();
      progress(host.startup.progress);
    },
    finish,
  };
}

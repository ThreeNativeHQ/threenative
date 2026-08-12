import { type Camera, Mesh, MeshBasicMaterial, PlaneGeometry, type Scene } from "three";

export const LOADING_BACKDROP = 0x0d1b2a;

interface LoadingHost {
  readonly camera: Camera;
  readonly canvasLayer: {
    readonly scene: Scene;
    opaque: boolean;
  };
  readonly renderer: { compileAsync(scene: Scene, camera: Camera): Promise<void> };
  readonly scene: Scene;
  readonly startup: { whenReady(): Promise<void> };
  readonly viewport: { readonly size: { readonly height: number; readonly width: number } };
}

/** A backdrop-only loading surface for the moving-waterfall regression scene. */
export function createLoadingBackdrop(host: LoadingHost) {
  const backdrop = new Mesh(
    new PlaneGeometry(1, 1),
    new MeshBasicMaterial({
      color: LOADING_BACKDROP,
      depthTest: false,
      depthWrite: false,
    }),
  );
  backdrop.frustumCulled = false;
  host.canvasLayer.scene.add(backdrop);
  host.canvasLayer.opaque = true;

  const layout = (): void => {
    const { height, width } = host.viewport.size;
    backdrop.scale.set(width, height, 1);
  };
  let laidOutWidth = host.viewport.size.width;
  let laidOutHeight = host.viewport.size.height;
  layout();

  let done = false;
  const finish = (): void => {
    if (done) return;
    done = true;
    host.canvasLayer.scene.remove(backdrop);
    host.canvasLayer.opaque = false;
    backdrop.geometry.dispose();
    backdrop.material.dispose();
  };

  void (async () => {
    await host.startup.whenReady();
    await host.renderer.compileAsync(host.scene, host.camera).catch(() => undefined);
    finish();
  })();

  return {
    update(): void {
      const { height, width } = host.viewport.size;
      if (done || (width === laidOutWidth && height === laidOutHeight)) return;
      laidOutWidth = width;
      laidOutHeight = height;
      layout();
    },
  };
}

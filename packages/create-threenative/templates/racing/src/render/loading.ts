import { Color, Mesh, MeshBasicMaterial, type OrthographicCamera, PlaneGeometry } from "three";

type LoadingContext = {
  readonly canvasLayer: {
    readonly camera: OrthographicCamera;
    readonly scene: { add(...objects: Mesh[]): void; remove(object: Mesh): void };
    opaque: boolean;
  };
  readonly startup: { readonly progress: number; whenReady(): Promise<void> };
};

export function createLoadingScreen(ctx: LoadingContext): { update(): void } {
  const layer = ctx.canvasLayer;
  const backdrop = new Mesh(
    new PlaneGeometry(1, 1),
    new MeshBasicMaterial({ color: new Color(0x07111d) }),
  );
  const track = new Mesh(
    new PlaneGeometry(1, 1),
    new MeshBasicMaterial({ color: new Color(0x16324a) }),
  );
  const fill = new Mesh(
    new PlaneGeometry(1, 1),
    new MeshBasicMaterial({ color: new Color(0xffcf4a) }),
  );
  layer.scene.add(backdrop, track, fill);
  layer.opaque = true;
  let done = false;
  const layout = (): void => {
    const width = layer.camera.right - layer.camera.left;
    const height = layer.camera.top - layer.camera.bottom;
    backdrop.scale.set(width, height, 1);
    track.scale.set(width * 0.5, height * 0.012, 1);
    track.position.set(0, -height * 0.05, 0);
    fill.position.set(-width * 0.25, -height * 0.05, 0);
  };
  layout();
  void ctx.startup.whenReady().then(() => {
    done = true;
    layer.opaque = false;
    for (const mesh of [backdrop, track, fill]) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial).dispose();
    }
  });
  return {
    update(): void {
      if (done) return;
      layout();
      const progress = Math.max(0, Math.min(1, ctx.startup.progress));
      const width = layer.camera.right - layer.camera.left;
      const fillWidth = Math.max(width * 0.002, width * 0.5 * progress);
      fill.scale.set(fillWidth, (layer.camera.top - layer.camera.bottom) * 0.012, 1);
      fill.position.x = -width * 0.25 + fillWidth / 2;
    },
  };
}

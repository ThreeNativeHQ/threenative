import {
  type Camera,
  CanvasTexture,
  ClampToEdgeWrapping,
  Mesh,
  MeshBasicMaterial,
  type OrthographicCamera,
  PlaneGeometry,
  type Scene,
  type Texture,
} from "three";
import { palette } from "./palette.js";

/** Edit these source constants for the starter's loading look. */
export const loading = {
  backgroundColor: palette.skyLow,
  backgroundImage: undefined as string | undefined,
  enabled: true,
  fillImage: undefined as string | undefined,
  logoImage: undefined as string | undefined,
  progressColor: palette.accent,
  showStatus: false,
  trackColor: palette.skyHigh,
  bar: { anchorX: 0.5, anchorY: 0.72, height: 12, maxWidth: 520, width: 0.62 },
} as const;

interface LoadingHost {
  readonly assets?: { texture(path: string): Promise<Texture> };
  readonly camera: Camera;
  readonly canvasLayer: {
    readonly camera: OrthographicCamera;
    readonly scene: Scene;
    opaque: boolean;
  };
  readonly renderer: { compileAsync(scene: Scene, camera: Camera): Promise<void> };
  readonly scene: Scene;
  readonly startup: { readonly progress: number; whenReady(): Promise<void> };
  readonly viewport?: {
    readonly safeArea: { height: number; width: number; x: number; y: number };
  };
}

function imageAspect(texture: Texture | null | undefined): number {
  const image = texture?.image as { height?: number; width?: number } | undefined;
  const width = image?.width ?? 1;
  const height = image?.height ?? 1;
  return width > 0 && height > 0 ? width / height : 1;
}

function configureTexture(texture: Texture): void {
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;
}

function setFillUv(geometry: PlaneGeometry, progress: number, base: readonly number[]): void {
  const uv = geometry.getAttribute("uv");
  for (let index = 0; index < uv.count; index += 1) uv.setX(index, (base[index] ?? 0) * progress);
  uv.needsUpdate = true;
}

function coverUv(
  geometry: PlaneGeometry,
  texture: Texture,
  width: number,
  height: number,
  baseU: readonly number[],
  baseV: readonly number[],
): void {
  const imageRatio = imageAspect(texture);
  const boxRatio = width / Math.max(1, height);
  const visibleU = imageRatio > boxRatio ? boxRatio / imageRatio : 1;
  const visibleV = imageRatio < boxRatio ? imageRatio / boxRatio : 1;
  const offsetU = (1 - visibleU) / 2;
  const offsetV = (1 - visibleV) / 2;
  const uv = geometry.getAttribute("uv");
  for (let index = 0; index < uv.count; index += 1) {
    uv.setX(index, offsetU + (baseU[index] ?? 0) * visibleU);
    uv.setY(index, offsetV + (baseV[index] ?? 0) * visibleV);
  }
  uv.needsUpdate = true;
}

function statusMesh(
  layer: LoadingHost["canvasLayer"],
):
  | { mesh: Mesh<PlaneGeometry, MeshBasicMaterial>; texture: Texture; update(value: number): void }
  | undefined {
  if (!loading.showStatus || typeof document === "undefined") return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = 180;
  canvas.height = 48;
  const context = canvas.getContext("2d");
  if (context === null) return undefined;
  const texture = new CanvasTexture(canvas);
  const mesh = new Mesh(
    new PlaneGeometry(1, 1),
    new MeshBasicMaterial({ depthTest: false, depthWrite: false, map: texture, transparent: true }),
  );
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  layer.scene.add(mesh);
  const update = (value: number): void => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#ffffff";
    context.font = "700 20px monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(`${Math.round(value * 100)}%`, canvas.width / 2, canvas.height / 2);
    texture.needsUpdate = true;
  };
  update(0);
  return { mesh, texture, update };
}

export function createLoadingScreen(host: LoadingHost) {
  const layer = host.canvasLayer;
  if (!loading.enabled) {
    layer.opaque = false;
    return { finish: () => undefined, update: () => undefined };
  }
  const mesh = (color: number, order: number): Mesh<PlaneGeometry, MeshBasicMaterial> => {
    const value = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({ color, depthTest: false, depthWrite: false }),
    );
    value.frustumCulled = false;
    value.renderOrder = order;
    layer.scene.add(value);
    return value;
  };
  const backdrop = mesh(loading.backgroundColor, 0);
  const track = mesh(loading.trackColor, 1);
  const fill = mesh(loading.progressColor, 2);
  const logo = mesh(0xffffff, 3);
  logo.visible = false;
  const status = statusMesh(layer);
  const parts = [backdrop, track, fill, logo, ...(status === undefined ? [] : [status.mesh])];
  const ownedTextures = new Set<Texture>(status === undefined ? [] : [status.texture]);
  const fillBaseU = Array.from({ length: fill.geometry.getAttribute("uv").count }, (_, index) =>
    fill.geometry.getAttribute("uv").getX(index),
  );
  const fillBaseV = Array.from({ length: fill.geometry.getAttribute("uv").count }, (_, index) =>
    fill.geometry.getAttribute("uv").getY(index),
  );
  const camera = layer.camera;
  let width = 1;
  let height = 1;
  let barWidth = 1;
  let barHeight: number = loading.bar.height;
  let barX = 0;
  let barY = 0;
  let progress = 0;
  let done = false;
  let backdropTexture: Texture | undefined;
  const layout = (): void => {
    width = Math.max(1, camera.right - camera.left);
    height = Math.max(1, camera.top - camera.bottom);
    const safe = host.viewport?.safeArea ?? { height, width, x: 0, y: 0 };
    const safeWidth = Math.max(1, Math.min(width, safe.width));
    const safeHeight = Math.max(1, Math.min(height, safe.height));
    const x = Math.max(0, Math.min(width - safeWidth, safe.x));
    const y = Math.max(0, Math.min(height - safeHeight, safe.y));
    barWidth = Math.max(2, Math.min(loading.bar.maxWidth, safeWidth * loading.bar.width));
    barHeight = Math.max(2, Math.min(loading.bar.height, safeHeight * 0.05));
    barX = x + safeWidth * loading.bar.anchorX;
    barY = y + safeHeight * loading.bar.anchorY;
    const worldX = (value: number): number => camera.left + value;
    const worldY = (value: number): number => camera.top - value;
    backdrop.scale.set(width, height, 1);
    backdrop.position.set(worldX(width / 2), worldY(height / 2), 0);
    track.scale.set(barWidth, barHeight, 1);
    track.position.set(worldX(barX), worldY(barY), 0);
    fill.scale.set(Math.max(1, barWidth * progress), barHeight, 1);
    fill.position.set(
      worldX(barX - barWidth / 2 + Math.max(1, barWidth * progress) / 2),
      worldY(barY),
      0,
    );
    if (logo.visible) {
      const logoWidth = Math.min(280, safeWidth * 0.42);
      logo.scale.set(
        logoWidth,
        Math.min(logoWidth / imageAspect(logo.material.map), safeHeight * 0.22),
        1,
      );
      logo.position.set(worldX(barX), worldY(Math.max(y, barY - safeHeight * 0.2)), 0);
    }
    if (status !== undefined) {
      status.mesh.scale.set(Math.min(180, safeWidth * 0.32), 48, 1);
      status.mesh.position.set(worldX(barX), worldY(Math.min(height, barY + barHeight * 2.5)), 0);
    }
    if (backdropTexture !== undefined)
      coverUv(backdrop.geometry, backdropTexture, width, height, fillBaseU, fillBaseV);
  };
  const updateProgress = (value: number): void => {
    progress = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    setFillUv(fill.geometry, progress, fillBaseU);
    status?.update(progress);
    layout();
  };
  const attach = (target: Mesh<PlaneGeometry, MeshBasicMaterial>, texture: Texture): void => {
    if (done) return;
    configureTexture(texture);
    target.material.map = texture;
    target.material.color.set(0xffffff);
    target.material.needsUpdate = true;
    ownedTextures.add(texture);
    if (target === backdrop) backdropTexture = texture;
    layout();
    updateProgress(progress);
  };
  const load = (
    source: string | undefined,
    target: Mesh<PlaneGeometry, MeshBasicMaterial>,
  ): void => {
    if (source === undefined || host.assets === undefined) return;
    void host.assets
      .texture(source)
      .then((texture) => attach(target, texture))
      .catch(() => undefined);
  };
  load(loading.backgroundImage, backdrop);
  load(loading.fillImage, fill);
  if (loading.logoImage !== undefined && host.assets !== undefined) {
    void host.assets
      .texture(loading.logoImage)
      .then((texture) => {
        if (done) return;
        configureTexture(texture);
        logo.material.map = texture;
        logo.material.needsUpdate = true;
        logo.visible = true;
        ownedTextures.add(texture);
        layout();
      })
      .catch(() => undefined);
  }
  layer.opaque = true;
  layout();
  updateProgress(0);
  const finish = (): void => {
    if (done) return;
    done = true;
    for (const value of parts) {
      value.removeFromParent();
      value.geometry.dispose();
      value.material.dispose();
    }
    for (const texture of ownedTextures) texture.dispose();
    layer.opaque = false;
  };
  void (async () => {
    await host.startup.whenReady();
    if (done) return;
    // Prewarm the world's shaders, but do not wait for them here. `whenReady()` already means the
    // world is safe to show, and compiling a lit, post-processed scene takes far longer than the
    // launch window: hold the screen for it and a playtest — which advances a fixed step as fast
    // as the machine allows — runs an entire scenario behind the launch screen, so every capture
    // photographs the loading bar instead of the game. The prewarm still happens; it no longer
    // decides when the player sees the world.
    try {
      void host.renderer.compileAsync(host.scene, host.camera).catch(() => undefined);
    } catch {
      // A renderer without compileAsync is not a reason to keep the world hidden.
    }
    finish();
  })();
  return {
    finish,
    update(): void {
      if (!done) updateProgress(host.startup.progress);
    },
  };
}

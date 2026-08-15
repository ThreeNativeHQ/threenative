import { type Mesh, MeshBasicMaterial, OrthographicCamera, PerspectiveCamera, Scene } from "three";
import { describe, expect, it, vi } from "vitest";
import { createLoadingScreen } from "../templates/minimal/src/render/loading.js";

/**
 * The loading screen is generated user source, but every scaffolded project starts from this copy,
 * so a defect here ships to every game that keeps the default loading screen.
 */
function host(width = 900, height = 900) {
  const camera = new PerspectiveCamera(60, width / height, 0.1, 2_000);
  const scene = new Scene();
  scene.add(camera);
  const canvasCamera = new OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, 0, 2);
  canvasCamera.position.z = 1;
  return {
    camera,
    canvasLayer: { camera: canvasCamera, opaque: false, scene: new Scene() },
    scene,
    // Neither promise resolves: the screen must be correct while it is still up, which is the point.
    renderer: { compileAsync: () => new Promise<void>(() => undefined) },
    startup: { progress: 0, whenReady: () => new Promise<void>(() => undefined) },
  };
}

/** The three quads, in the order the screen adds them: backdrop, track, fill. */
function quads(scene: Scene): { backdrop: Mesh; track: Mesh; fill: Mesh } {
  const meshes = scene.children.filter((child): child is Mesh => (child as Mesh).isMesh === true);
  if (meshes.length !== 3) throw new Error(`expected 3 loading quads, found ${meshes.length}`);
  const [backdrop, track, fill] = meshes as [Mesh, Mesh, Mesh];
  return { backdrop, track, fill };
}

function resizeCanvas(camera: OrthographicCamera, width: number, height: number): void {
  camera.left = -width / 2;
  camera.right = width / 2;
  camera.top = height / 2;
  camera.bottom = -height / 2;
  camera.updateProjectionMatrix();
}

describe("template loading screen", () => {
  it("draws opaque quads only in the independent canvas layer", () => {
    const source = host();
    const worldChildren = [...source.scene.children];
    createLoadingScreen(source);
    const { backdrop, track, fill } = quads(source.canvasLayer.scene);

    expect(source.canvasLayer.opaque).toBe(true);
    expect(source.scene.children).toEqual(worldChildren);
    expect(source.canvasLayer.camera.children).toEqual([]);
    for (const quad of [backdrop, track, fill]) {
      expect(quad.parent).toBe(source.canvasLayer.scene);
      expect(quad.material).toBeInstanceOf(MeshBasicMaterial);
      expect((quad.material as MeshBasicMaterial).transparent).toBe(false);
      expect(quad.renderOrder).toBeLessThanOrEqual(1_000);
    }
  });

  it("sizes the progress fill before the first frame, not on the first update", () => {
    const source = host();
    createLoadingScreen(source);
    const { track, fill } = quads(source.canvasLayer.scene);

    expect(fill.scale.x).not.toBe(1);
    expect(fill.scale.y).not.toBe(1);
    expect(fill.scale.y).toBeCloseTo(track.scale.y, 6);
    expect(fill.scale.x).toBeLessThan(track.scale.x);
  });

  it("never lets the fill outgrow the track, whatever progress reports", () => {
    const source = host();
    const loading = createLoadingScreen(source);
    const { track, fill } = quads(source.canvasLayer.scene);

    for (const progress of [0, 0.25, 0.5, 1, 2, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      source.startup.progress = progress;
      loading.update();
      expect(fill.scale.y).toBeCloseTo(track.scale.y, 6);
      expect(fill.scale.x).toBeLessThanOrEqual(track.scale.x + 1e-9);
      expect(Number.isFinite(fill.scale.x)).toBe(true);
      expect(Number.isFinite(fill.position.x)).toBe(true);
    }
  });

  it.each([
    ["portrait", 1080, 2400],
    ["landscape", 2400, 1080],
    ["square", 1080, 1080],
  ])("keeps the bar inside the pixel-sized viewport in %s", (_name, width, height) => {
    const source = host(width, height);
    const loading = createLoadingScreen(source);
    const { backdrop, track, fill } = quads(source.canvasLayer.scene);

    expect(track.scale.x).toBeLessThanOrEqual(width);
    expect(backdrop.scale.x).toBe(width);
    expect(backdrop.scale.y).toBe(height);

    for (const progress of [0, 0.5, 1]) {
      source.startup.progress = progress;
      loading.update();
      const left = fill.position.x - fill.scale.x / 2;
      const right = fill.position.x + fill.scale.x / 2;
      expect(left).toBeGreaterThanOrEqual(-track.scale.x / 2 - 1e-9);
      expect(right).toBeLessThanOrEqual(track.scale.x / 2 + 1e-9);
    }
  });

  it("relays out when the device rotates mid-load", () => {
    const source = host(2400, 1080);
    const loading = createLoadingScreen(source);
    const { backdrop, track } = quads(source.canvasLayer.scene);
    const landscapeTrack = track.scale.x;

    resizeCanvas(source.canvasLayer.camera, 1080, 2400);
    source.startup.progress = 0.5;
    loading.update();

    expect(track.scale.x).toBeLessThan(landscapeTrack);
    expect(backdrop.scale.x).toBe(1080);
    expect(backdrop.scale.y).toBe(2400);
  });

  it("removes and disposes its quads before making the canvas layer transparent", () => {
    const source = host();
    const loading = createLoadingScreen(source);
    const parts = Object.values(quads(source.canvasLayer.scene));
    const disposals = parts.flatMap((mesh) => [
      vi.spyOn(mesh.geometry, "dispose"),
      vi.spyOn(mesh.material as MeshBasicMaterial, "dispose"),
    ]);

    loading.finish();

    expect(source.canvasLayer.scene.children).toEqual([]);
    expect(source.canvasLayer.opaque).toBe(false);
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledOnce();
  });

  it("compiles the collapsed world behind the opaque screen before reveal", async () => {
    let ready: () => void = () => undefined;
    let compiled: () => void = () => undefined;
    const readyPromise = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const compilePromise = new Promise<void>((resolve) => {
      compiled = resolve;
    });
    const source = host();
    source.startup.whenReady = () => readyPromise;
    source.renderer.compileAsync = vi.fn(() => compilePromise);
    createLoadingScreen(source);

    ready();
    await Promise.resolve();
    expect(source.renderer.compileAsync).toHaveBeenCalledWith(source.scene, source.camera);
    expect(source.canvasLayer.opaque).toBe(true);
    expect(source.canvasLayer.scene.children).toHaveLength(3);

    compiled();
    await compilePromise;
    await Promise.resolve();
    expect(source.canvasLayer.scene.children).toEqual([]);
    expect(source.canvasLayer.opaque).toBe(false);
  });

  it("does not leave a one-frame screen when startup and compilation are already settled", async () => {
    const source = host();
    source.startup.whenReady = () => Promise.resolve();
    source.renderer.compileAsync = vi.fn(() => Promise.resolve());

    createLoadingScreen(source);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(source.renderer.compileAsync).toHaveBeenCalledOnce();
    expect(source.canvasLayer.scene.children).toEqual([]);
    expect(source.canvasLayer.opaque).toBe(false);
  });
});

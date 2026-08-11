import { type Mesh, PerspectiveCamera, Scene } from "three";
import { describe, expect, it } from "vitest";
import { createLoadingScreen } from "../templates/starter/src/render/loading.js";

/**
 * The loading screen is generated user source, but every scaffolded project starts from this copy,
 * so a defect here ships to every game at once.
 *
 * The defect this guards: the fill quad's position was set at construction and its scale only
 * inside `update()`, so the first frame drew `PlaneGeometry(1, 1)` at its default scale. The layout
 * sizes for a 4:1 ratio, so on a portrait phone that one-unit square covers the viewport — a
 * physical Pixel 8 recording measured the frame before the backdrop at 96.33% progress-bar green.
 */
function host() {
  const camera = new PerspectiveCamera(60, 1, 0.1, 2_000);
  const scene = new Scene();
  scene.add(camera);
  return {
    camera,
    scene,
    // Neither promise resolves: the screen must be correct while it is still up, which is the point.
    renderer: { compileAsync: () => new Promise<void>(() => undefined) },
    startup: { progress: 0, whenReady: () => new Promise<void>(() => undefined) },
  };
}

/** The three quads, in the order the screen adds them: backdrop, track, fill. */
function quads(camera: PerspectiveCamera): { backdrop: Mesh; track: Mesh; fill: Mesh } {
  const meshes = camera.children.filter((child): child is Mesh => (child as Mesh).isMesh === true);
  // Fail closed: indexing a short list would otherwise assert against `undefined` and pass.
  if (meshes.length !== 3) throw new Error(`expected 3 loading quads, found ${meshes.length}`);
  const [backdrop, track, fill] = meshes as [Mesh, Mesh, Mesh];
  return { backdrop, track, fill };
}

describe("template loading screen", () => {
  it("sizes the progress fill before the first frame, not on the first update", () => {
    const source = host();
    createLoadingScreen(source);
    const { track, fill } = quads(source.camera);

    // The bug leaves the fill at PlaneGeometry(1, 1)'s default scale.
    expect(fill.scale.x).not.toBe(1);
    expect(fill.scale.y).not.toBe(1);
    // At zero progress the fill is a sliver of the track, never taller and never wider.
    expect(fill.scale.y).toBeCloseTo(track.scale.y, 6);
    expect(fill.scale.x).toBeLessThan(track.scale.x);
  });

  it("never lets the fill outgrow the track, whatever progress reports", () => {
    const source = host();
    const loading = createLoadingScreen(source);
    const { track, fill } = quads(source.camera);

    // NaN is in the list because `Math.max(0, Math.min(1, NaN))` is NaN: the obvious clamp does
    // not clamp, and one NaN reaching the quad's scale stops the bar rendering at all.
    for (const progress of [0, 0.25, 0.5, 1, 2, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      source.startup.progress = progress;
      loading.update();
      expect(fill.scale.y).toBeCloseTo(track.scale.y, 6);
      expect(fill.scale.x).toBeLessThanOrEqual(track.scale.x + 1e-9);
      expect(Number.isFinite(fill.scale.x)).toBe(true);
      expect(Number.isFinite(fill.position.x)).toBe(true);
    }
  });
});

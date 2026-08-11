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
function host(aspect = 1) {
  const camera = new PerspectiveCamera(60, aspect, 0.1, 2_000);
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

  // A phone is portrait about half the time, and the bar was laid out for a fixed 4:1 ratio.
  it.each([
    ["portrait", 1080 / 2400],
    ["landscape", 2400 / 1080],
    ["square", 1],
  ])("keeps the bar inside the viewport in %s", (_name, aspect) => {
    const source = host(aspect);
    const loading = createLoadingScreen(source);
    const { backdrop, track, fill } = quads(source.camera);

    const visibleWidth = 2 * Math.tan((60 * Math.PI) / 360) * aspect;
    // The track must fit the screen it is drawn on, and the backdrop must still cover it.
    expect(track.scale.x).toBeLessThanOrEqual(visibleWidth + 1e-9);
    expect(backdrop.scale.x).toBeGreaterThanOrEqual(visibleWidth);

    // At any progress the fill stays within the track's span, so it never starts off-screen.
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
    const source = host(2400 / 1080);
    const loading = createLoadingScreen(source);
    const { track } = quads(source.camera);
    const landscapeTrack = track.scale.x;

    source.camera.aspect = 1080 / 2400;
    source.startup.progress = 0.5;
    loading.update();

    expect(track.scale.x).toBeLessThan(landscapeTrack);
    const visiblePortrait = 2 * Math.tan((60 * Math.PI) / 360) * (1080 / 2400);
    expect(track.scale.x).toBeLessThanOrEqual(visiblePortrait + 1e-9);
  });
});

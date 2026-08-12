import { type BufferAttribute, Mesh, PerspectiveCamera, PlaneGeometry, Vector2 } from "three";
import { acceleratedRaycast } from "three-mesh-bvh";
import { describe, expect, it, vi } from "vitest";
import { ScenePicker } from "../src/picking.js";
import { type IViewportSize, Viewport } from "../src/viewport.js";

function renderer(canvas: HTMLCanvasElement) {
  return {
    canvas,
    compileAsync: async () => undefined,
    compute: () => undefined,
    domElement: canvas,
    kind: "webgl2" as const,
    raw: {},
    render: () => undefined,
    renderOverlay: () => undefined,
    setOutputNode: () => undefined,
    setSize: () => undefined,
    dispose: () => undefined,
  };
}

function testCanvas(width = 1280, height = 720): HTMLCanvasElement & { size: IViewportSize } {
  const canvas = new EventTarget() as HTMLCanvasElement & { size: IViewportSize };
  Object.defineProperties(canvas, {
    clientHeight: { configurable: true, get: () => canvas.size.height },
    clientWidth: { configurable: true, get: () => canvas.size.width },
  });
  canvas.size = { aspect: width / height, height, width };
  return canvas;
}

function scenePicker(...contents: Mesh[]) {
  const camera = new PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.z = 5;
  camera.lookAt(0, 0, 0);
  const viewport = new Viewport({ camera, renderer: renderer(testCanvas()) });
  const root = new Mesh();
  for (const child of contents) root.add(child);
  const picker = new ScenePicker({
    camera,
    pointer: () => new Vector2(640, 360),
    scene: root,
    viewport,
  });
  return { camera, picker, root, viewport };
}

/** Subdivided so the hierarchy is more than a single leaf, which is what makes stale bounds observable. */
function plane(name: string, z: number): Mesh {
  const mesh = new Mesh(new PlaneGeometry(2, 2, 32, 32));
  mesh.name = name;
  mesh.position.z = z;
  return mesh;
}

describe("ScenePicker", () => {
  it("returns the nearest hit under the pointer and nothing when the ray misses", () => {
    const near = plane("near", 2);
    const far = plane("far", 0);
    const { picker } = scenePicker(far, near);

    const hit = picker.raycast();
    expect(hit?.object.name).toBe("near");
    expect(hit?.distance).toBeCloseTo(3, 5);

    expect(picker.raycast({ screen: new Vector2(0, 0) })).toBeUndefined();
  });

  it("takes the accelerated path without patching any three prototype", () => {
    const target = plane("target", 0);
    const { picker } = scenePicker(target);
    const stock = vi.spyOn(target, "raycast");

    expect(picker.raycast()?.object.name).toBe("target");
    expect(stock).not.toHaveBeenCalled();
    expect(Mesh.prototype.raycast).not.toBe(acceleratedRaycast);
  });

  it("falls back to the stock raycast for a morphed mesh", () => {
    const target = plane("morphed", 0);
    target.morphTargetInfluences = [0];
    const { picker } = scenePicker(target);
    const stock = vi.spyOn(target, "raycast");

    expect(picker.raycast()?.object.name).toBe("morphed");
    expect(stock).toHaveBeenCalledTimes(1);
  });

  it("rebuilds the hierarchy when the geometry's positions change", () => {
    const target = plane("moved", 0);
    const position = target.geometry.attributes.position as BufferAttribute;
    for (let index = 0; index < position.count; index += 1)
      position.setX(index, position.getX(index) + 10);
    const { picker } = scenePicker(target);

    expect(picker.raycast()).toBeUndefined();

    for (let index = 0; index < position.count; index += 1)
      position.setX(index, position.getX(index) - 10);
    position.version += 1;

    expect(picker.raycast()?.object.name).toBe("moved");
  });

  it("drops cached hierarchies on dispose and rebuilds them on the next query", () => {
    const target = plane("kept", 0);
    const { picker } = scenePicker(target);

    expect(picker.raycast()?.object.name).toBe("kept");
    picker.dispose();
    expect(picker.raycast()?.object.name).toBe("kept");
  });

  it("rejects a screen point that is not finite", () => {
    const { picker } = scenePicker(plane("target", 0));
    expect(() => picker.raycast({ screen: new Vector2(Number.NaN, 0) })).toThrow(/must be finite/u);
  });
});

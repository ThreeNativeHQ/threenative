import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Vector2 } from "three";
import { describe, expect, it, vi } from "vitest";
import { ScenePicker } from "../src/picking.js";
import { type IViewportSize, Viewport } from "../src/viewport.js";

function testCanvas(width = 1280, height = 720): HTMLCanvasElement & { size: IViewportSize } {
  const canvas = new EventTarget() as HTMLCanvasElement & { size: IViewportSize };
  Object.defineProperties(canvas, {
    clientHeight: { configurable: true, get: () => canvas.size.height },
    clientWidth: { configurable: true, get: () => canvas.size.width },
  });
  canvas.size = { aspect: width / height, height, width };
  return canvas;
}

function rendererStub(canvas: HTMLCanvasElement) {
  return {
    canvas,
    compileAsync: async () => undefined,
    compute: () => undefined,
    domElement: canvas,
    info: {},
    kind: "webgl2" as const,
    raw: {},
    render: () => undefined,
    renderOverlay: () => undefined,
    setOutputNode: () => undefined,
    setSize: () => undefined,
    setResolutionScale: () => undefined,
    surface: () => ({
      atFloor: false,
      drawingBufferHeight: 1,
      drawingBufferWidth: 1,
      resolutionScale: 1,
      sampleCount: 1,
      scaleSource: "pinned" as const,
    }),
    dispose: () => undefined,
  };
}

/**
 * A scene whose meshes each sit five groups deep, so an unconditional parent-chain walk in the
 * exclusion check is visible in the lookup count.
 */
function deepScene(meshCount: number): Mesh {
  const root = new Mesh();
  const geometry = new BoxGeometry(1, 1, 1);
  for (let index = 0; index < meshCount; index += 1) {
    let level: Group = new Group();
    const first = level;
    for (let depth = 0; depth < 5; depth += 1) {
      const next = new Group();
      level.add(next);
      level = next;
    }
    level.add(new Mesh(geometry, new MeshBasicMaterial()));
    root.add(first);
  }
  return root;
}

function pickerOver(root: Mesh): ScenePicker {
  const camera = new PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.z = 5;
  camera.lookAt(0, 0, 0);
  const viewport = new Viewport({ camera, renderer: rendererStub(testCanvas()) });
  return new ScenePicker({
    camera,
    pointer: () => new Vector2(640, 360),
    scene: root,
    viewport,
  });
}

describe("ScenePicker exclusion cost", () => {
  it("performs zero exclusion lookups when no exclude option was given", () => {
    const root = deepScene(24);
    const picker = pickerOver(root);
    // Warm the BVH and every cache outside the counted window.
    picker.raycast();

    let lookups = 0;
    const realHas = Set.prototype.has;
    const spy = vi.spyOn(Set.prototype, "has");
    spy.mockImplementation(function (this: Set<unknown>, value: unknown) {
      lookups += 1;
      return realHas.call(this, value);
    });
    try {
      picker.raycast();
    } finally {
      spy.mockRestore();
    }
    expect(lookups).toBe(0);
  });

  it("still consults the exclusion set when an exclude option was given", () => {
    const root = deepScene(8);
    const picker = pickerOver(root);
    picker.raycast();

    let lookups = 0;
    const realHas = Set.prototype.has;
    const spy = vi.spyOn(Set.prototype, "has");
    spy.mockImplementation(function (this: Set<unknown>, value: unknown) {
      lookups += 1;
      return realHas.call(this, value);
    });
    try {
      const first = root.children[0] as Mesh;
      picker.raycast({ exclude: first });
    } finally {
      spy.mockRestore();
    }
    expect(lookups).toBeGreaterThan(0);
  });
});

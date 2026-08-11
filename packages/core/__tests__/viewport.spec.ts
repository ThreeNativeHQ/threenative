import { OrthographicCamera, PerspectiveCamera, Vector2, Vector3 } from "three";
import { afterEach, describe, expect, it } from "vitest";
import { type IViewportSize, Viewport } from "../src/viewport.js";

class FakeResizeObserver {
  static current: FakeResizeObserver | undefined;
  readonly callback: () => void;
  disconnected = false;

  constructor(callback: () => void) {
    this.callback = callback;
    FakeResizeObserver.current = this;
  }

  observe(): void {}

  disconnect(): void {
    this.disconnected = true;
  }

  trigger(): void {
    if (!this.disconnected) this.callback();
  }
}

function renderer(canvas: HTMLCanvasElement) {
  return {
    canvas,
    compileAsync: async () => undefined,
    compute: () => undefined,
    domElement: canvas,
    kind: "webgl2" as const,
    raw: {},
    render: () => undefined,
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

const resizeObserverDescriptor = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");

afterEach(() => {
  if (resizeObserverDescriptor === undefined) Reflect.deleteProperty(globalThis, "ResizeObserver");
  else Object.defineProperty(globalThis, "ResizeObserver", resizeObserverDescriptor);
  FakeResizeObserver.current = undefined;
});

describe("Viewport", () => {
  it("keeps a perspective camera and resize subscribers synchronized", () => {
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: FakeResizeObserver,
    });
    const canvas = testCanvas();
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    const before = camera.projectionMatrix.clone();
    const viewport = new Viewport({ camera, renderer: renderer(canvas) });
    const sizes: IViewportSize[] = [];
    const stop = viewport.onResize((size) => sizes.push(size));

    expect(viewport.size).toEqual({ aspect: 1280 / 720, height: 720, width: 1280 });
    expect(camera.aspect).toBeCloseTo(1280 / 720);
    expect(camera.projectionMatrix.equals(before)).toBe(false);

    canvas.size = { aspect: 720 / 1280, height: 1280, width: 720 };
    FakeResizeObserver.current?.trigger();
    expect(viewport.size.aspect).toBeCloseTo(720 / 1280);
    expect(camera.aspect).toBeCloseTo(720 / 1280);
    expect(sizes).toHaveLength(1);

    stop();
    viewport.dispose();
    canvas.size = { aspect: 1, height: 720, width: 720 };
    FakeResizeObserver.current?.trigger();
    expect(sizes).toHaveLength(1);
  });

  it("reframes orthogonal cameras and projects screen coordinates in world units", () => {
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: FakeResizeObserver,
    });
    const canvas = testCanvas();
    const camera = new OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
    camera.position.z = 10;
    camera.lookAt(0, 0, 0);
    const viewport = new Viewport({ camera, renderer: renderer(canvas) });

    expect(camera.left).toBeCloseTo(-(10 * (1280 / 720)));
    expect(camera.right).toBeCloseTo(10 * (1280 / 720));
    const centre = viewport.projectPosition(new Vector2(640, 360));
    expect(centre.x).toBeCloseTo(0);
    expect(centre.y).toBeCloseTo(0);
    expect(centre.z).toBeCloseTo(0);
    expect(viewport.unprojectPosition(new Vector3(0, 0, 0))).toEqual(new Vector2(640, 360));
  });

  it("projects a perspective screen point onto a world plane", () => {
    const canvas = testCanvas();
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.z = 10;
    camera.lookAt(0, 0, 0);
    const viewport = new Viewport({ camera, renderer: renderer(canvas) });
    const right = viewport.projectPosition(new Vector2(1280, 360));
    const expected = Math.tan((60 * Math.PI) / 360) * 10 * (1280 / 720);
    expect(right.x).toBeCloseTo(expected, 6);
    expect(right.y).toBeCloseTo(0, 6);
    const screen = viewport.unprojectPosition(new Vector3(0, 0, 0));
    expect(screen.x).toBeCloseTo(640, 6);
    expect(screen.y).toBeCloseTo(360, 6);
  });
});

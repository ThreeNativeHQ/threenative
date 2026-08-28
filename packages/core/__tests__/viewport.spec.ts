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
    info: {},
    kind: "webgl2" as const,
    raw: {},
    render: () => undefined,
    renderOverlay: () => undefined,
    setOutputNode: () => undefined,
    setSize: () => undefined,
    setResolutionScale: () => undefined,
    surface: () => ({
      drawingBufferHeight: 1,
      drawingBufferWidth: 1,
      resolutionScale: 1,
      sampleCount: 1,
      scaleSource: "pinned" as const,
    }),
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

/** Installs stand-in browser globals for one call, then restores whatever was there before. */
function withGlobals(values: Record<string, unknown>, body: () => void): void {
  const restore = Object.entries(values).map(
    ([name]) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  try {
    for (const [name, value] of Object.entries(values)) {
      Object.defineProperty(globalThis, name, { configurable: true, value });
    }
    body();
  } finally {
    for (const [name, descriptor] of restore) {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, name);
      else Object.defineProperty(globalThis, name, descriptor);
    }
  }
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

  it("fills caller targets without mutating projection inputs", () => {
    const canvas = testCanvas();
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.z = 10;
    camera.lookAt(0, 0, 0);
    const viewport = new Viewport({ camera, renderer: renderer(canvas) });
    const screen = new Vector2(1280, 360);
    const originalScreen = screen.clone();
    const projectedTarget = new Vector3();
    const projected = viewport.projectPosition(screen, 0, projectedTarget);

    expect(projected).toBe(projectedTarget);
    expect(screen).toEqual(originalScreen);

    const world = new Vector3(0, 0, 0);
    const originalWorld = world.clone();
    const screenTarget = new Vector2();
    const unprojected = viewport.unprojectPosition(world, screenTarget);

    expect(unprojected).toBe(screenTarget);
    expect(world).toEqual(originalWorld);
  });

  it("keeps an asymmetric measured safe rectangle through resize", () => {
    const canvas = testCanvas();
    let insets = { bottom: 24, left: 18, right: 42, top: 80 };
    const source = {
      observeResize: (_canvas: HTMLCanvasElement, resize: () => void) => {
        FakeResizeObserver.current = {
          callback: resize,
          disconnected: false,
        } as FakeResizeObserver;
        return () => undefined;
      },
      readSafeArea: () => insets,
      readSize: () => canvas.size,
    };
    const viewport = new Viewport({
      camera: new OrthographicCamera(-1, 1, 1, -1),
      renderer: renderer(canvas),
      source,
    });

    expect(viewport.safeArea).toMatchObject({
      bottom: 24,
      left: 18,
      right: 42,
      source: "measured",
      top: 80,
      width: 1220,
      x: 18,
      y: 80,
    });
    insets = { bottom: 12, left: 60, right: 10, top: 30 };
    canvas.size = { aspect: 720 / 1280, height: 1280, width: 720 };
    viewport.resize();
    expect(viewport.safeArea).toMatchObject({
      bottom: 12,
      left: 60,
      right: 10,
      source: "measured",
      top: 30,
      width: 650,
      x: 60,
      y: 30,
    });
  });

  it("reports the full drawable when the host cannot measure insets", () => {
    const canvas = testCanvas(640, 360);
    const viewport = new Viewport({ camera: new PerspectiveCamera(), renderer: renderer(canvas) });
    expect(viewport.safeArea).toEqual({
      bottom: 0,
      height: 360,
      left: 0,
      right: 0,
      source: "full-drawable-fallback",
      top: 0,
      width: 640,
      x: 0,
      y: 0,
    });
  });

  it("does not report a measured safe area when the probe cannot be attached", () => {
    // A document whose body is not there yet. The probe stays detached, every computed padding
    // resolves to the empty string, and four parsed zeroes look exactly like a device with no
    // insets. Claiming `measured` for that is the dishonest green this asserts against.
    const style = { paddingBottom: "", paddingLeft: "", paddingRight: "", paddingTop: "" };
    const probe = { remove: () => undefined, style: { cssText: "" } };
    withGlobals(
      {
        document: { body: null, createElement: () => probe },
        window: { getComputedStyle: () => style },
      },
      () => {
        const canvas = testCanvas(640, 360);
        const viewport = new Viewport({
          camera: new PerspectiveCamera(),
          renderer: renderer(canvas),
        });
        expect(viewport.safeArea.source).toBe("full-drawable-fallback");
      },
    );
  });
});

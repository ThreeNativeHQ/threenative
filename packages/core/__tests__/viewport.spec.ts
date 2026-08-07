import { PerspectiveCamera } from "three";
import { afterEach, describe, expect, it } from "vitest";
import { Viewport, type ViewportSize } from "../src/viewport.js";

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
    domElement: canvas,
    kind: "webgl2" as const,
    raw: {},
    render: () => undefined,
    setSize: () => undefined,
    dispose: () => undefined,
  };
}

function testCanvas(width = 1280, height = 720): HTMLCanvasElement & { size: ViewportSize } {
  const canvas = new EventTarget() as HTMLCanvasElement & { size: ViewportSize };
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
    const sizes: ViewportSize[] = [];
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
});

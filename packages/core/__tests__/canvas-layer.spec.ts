import { describe, expect, it } from "vitest";
import { CanvasLayer } from "../src/canvas-layer.js";
import type { IViewportSize } from "../src/viewport.js";

describe("CanvasLayer", () => {
  it("owns an empty scene and keeps its orthographic camera in viewport pixel units", () => {
    let resize: ((size: IViewportSize) => void) | undefined;
    let stopped = 0;
    const layer = new CanvasLayer({
      onResize: (handler) => {
        resize = handler;
        return () => {
          stopped += 1;
        };
      },
      size: { aspect: 16 / 9, height: 180, width: 320 },
    });

    expect(layer.scene.children).toHaveLength(0);
    expect(layer.opaque).toBe(false);
    expect([layer.camera.left, layer.camera.right, layer.camera.top, layer.camera.bottom]).toEqual([
      -160, 160, 90, -90,
    ]);

    resize?.({ aspect: 2, height: 320, width: 640 });
    expect([layer.camera.left, layer.camera.right, layer.camera.top, layer.camera.bottom]).toEqual([
      -320, 320, 160, -160,
    ]);

    layer.dispose();
    expect(stopped).toBe(1);
  });
});

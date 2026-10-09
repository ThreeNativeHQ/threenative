import { describe, expect, it } from "vitest";

import { defineWebRenderer } from "../src/browser-renderer.js";

describe("browser renderer samples and antialias parameter", () => {
  it("defaults samples to 0 and sets samples to 4 when antialias is true", () => {
    class MockColor {
      r = 0;
      g = 0;
      b = 0;
    }
    const fakeModule = {
      _tnw_web_init: () => 0,
      _tnw_web_set_samples: () => 0,
      _tnw_web_poll: () => 1,
      _tnw_web_error: () => 0,
      _tnw_web_adapter: () => 0,
      _tnw_web_resize: () => 0,
      _tnw_web_render: () => 0,
      _tnw_web_renderer_state: () => 0,
      _tnw_web_frame: () => 0,
      _tnw_web_render_target: () => 0,
      _tnw_web_read_target: () => 0,
      _tnw_web_read_target_take: () => 0,
      _tnw_web_gpu_timer: () => 0,
      specialHTMLTargets: {},
      lengthBytesUTF8: () => 0,
      _malloc: () => 0,
      stringToUTF8: () => {},
      _free: () => {},
      UTF8ToString: () => "",
      HEAPU8: new Uint8Array(1024),
    } as unknown as Parameters<typeof defineWebRenderer>[0];

    const mockCanvas = {
      setAttribute: () => {},
      width: 100,
      height: 100,
      style: {},
    } as unknown as HTMLCanvasElement;

    const RendererDefault = defineWebRenderer(fakeModule, MockColor);
    const rDefault = new RendererDefault({ canvas: mockCanvas }) as { samples: number };
    expect(rDefault.samples).toBe(0);

    const RendererFalse = defineWebRenderer(fakeModule, MockColor);
    const rFalse = new RendererFalse({ canvas: mockCanvas, antialias: false }) as {
      samples: number;
    };
    expect(rFalse.samples).toBe(0);

    const RendererTrue = defineWebRenderer(fakeModule, MockColor);
    const rTrue = new RendererTrue({ canvas: mockCanvas, antialias: true }) as { samples: number };
    expect(rTrue.samples).toBe(4);
  });
});

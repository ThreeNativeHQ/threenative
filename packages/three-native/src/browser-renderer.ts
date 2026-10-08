/**
 * `WebGPURenderer` on the Wasm engine (PRD-540): three's renderer surface over the product host
 * (`packages/runtime-native/src/engine/wasm/web_host.cpp`). The engine owns the device, the canvas
 * surface and every draw; this class turns three's calls into host calls and reports what the
 * engine did. What it does not implement throws its diagnostic rather than doing nothing.
 */
import { type TnAbiModule, engineRef } from "./browser-backend.js";

/** The product host's exports beside the catalog ABI (all numbers: pointers, sizes, status). */
type HostCall =
  | "_tnw_web_init"
  | "_tnw_web_poll"
  | "_tnw_web_error"
  | "_tnw_web_adapter"
  | "_tnw_web_resize"
  | "_tnw_web_render"
  | "_tnw_web_frame";

export type WebHostModule = Record<HostCall, (...args: number[]) => number> & {
  readonly specialHTMLTargets: Record<string, unknown>;
};

export type WebEngineModule = TnAbiModule & WebHostModule;

export function isWebHostModule(module: TnAbiModule): module is WebEngineModule {
  return typeof (module as Partial<WebHostModule>)._tnw_web_init === "function";
}

/** The canvas key the host's surface looks up; Emscripten resolves it before any DOM query. */
const CANVAS_TARGET = "!threenative-canvas";
const READY = 1;
/** The facade's own redraw, for RenderPipeline (browser-entry.ts). */
export const RENDER_AGAIN = Symbol("tn.renderAgain");
const FAILED = 2;

interface IAdapterInfo {
  readonly vendor: string;
  readonly architecture: string;
  readonly description: string;
  readonly device: string;
}

interface IColorLike {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

function unsupported(name: string): never {
  throw new Error(`TN_NATIVE_UNSUPPORTED_${name.toUpperCase()}: not available on the Wasm engine.`);
}

/** Defines the renderer class over one loaded module; the module owns one device and one canvas. */
export function defineWebRenderer(
  module: WebEngineModule,
  Color: new (...args: unknown[]) => IColorLike,
  beforeRender: () => void = () => {},
): new (
  parameters?: Record<string, unknown>,
) => object {
  let claimed = false;
  const string = (text: string): number => {
    const bytes = module.lengthBytesUTF8(text) + 1;
    const pointer = module._malloc(bytes);
    module.stringToUTF8(text, pointer, bytes);
    return pointer;
  };
  const check = (status: number): void => {
    if (status !== 0) throw new Error(module.UTF8ToString(module._tnw_web_error()));
  };
  // Two tn_handle_t (12 bytes each): the scene and the camera of the current render() call.
  let handles = 0;
  const writeHandle = (offset: number, object: unknown, what: string): void => {
    const ref = typeof object === "object" && object !== null ? engineRef(object) : undefined;
    if (ref === undefined)
      throw new TypeError(`TN_WASM_RENDER: the ${what} is not an engine object.`);
    const [type, context, slot, generation] = ref.key.split(":").map(Number) as [
      number,
      number,
      number,
      number,
    ];
    const view = new DataView(module.HEAPU8.buffer);
    view.setUint16(handles + offset, type, true);
    view.setUint16(handles + offset + 2, context, true);
    view.setUint32(handles + offset + 4, slot, true);
    view.setUint32(handles + offset + 8, generation, true);
  };

  return class WebGPURenderer {
    readonly isWebGPURenderer = true;
    readonly domElement: HTMLCanvasElement;
    readonly info = {
      autoReset: true,
      frame: 0,
      calls: 0,
      render: { calls: 0, drawCalls: 0, frameCalls: 0, triangles: 0, timestamp: 0 },
      compute: { calls: 0, frameCalls: 0, timestamp: 0 },
      memory: { geometries: 0, textures: 0 },
      reset(): void {},
    };
    readonly samples = 1;
    autoClear = true;
    toneMapping = 0;
    toneMappingExposure = 1;
    outputColorSpace = "srgb";
    /** What core reads to name the adapter: the engine's own device, not a second request. */
    readonly backend: { readonly gpu: { requestAdapter(): Promise<{ info: IAdapterInfo }> } };
    #pixelRatio = 1;
    #width: number;
    #height: number;
    #clear: [number, number, number, number] = [0, 0, 0, 1];
    #initialized: Promise<this> | undefined;
    #adapter: IAdapterInfo | undefined;
    #last: [unknown, unknown] | undefined;

    constructor(parameters: Record<string, unknown> = {}) {
      if (claimed)
        throw new Error("TN_WASM_RENDERER_SINGLE: the Wasm engine drives one renderer per page.");
      claimed = true;
      this.domElement =
        (parameters.canvas as HTMLCanvasElement | undefined) ?? document.createElement("canvas");
      this.#width = this.domElement.width || 300;
      this.#height = this.domElement.height || 150;
      const adapter = () => this.#adapter;
      this.backend = {
        gpu: {
          async requestAdapter() {
            const info = adapter();
            if (info === undefined) throw new Error("TN_WASM_RENDERER: init() has not finished.");
            return { info };
          },
        },
      };
    }

    init(): Promise<this> {
      this.#initialized ??= (async () => {
        module.specialHTMLTargets[CANVAS_TARGET] = this.domElement;
        handles = module._malloc(24);
        const selector = string(CANVAS_TARGET);
        try {
          check(module._tnw_web_init(selector, this.#drawWidth(), this.#drawHeight()));
        } finally {
          module._free(selector);
        }
        for (;;) {
          const state = module._tnw_web_poll();
          if (state === READY) break;
          if (state === FAILED) check(1);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        const field = (index: number) => module.UTF8ToString(module._tnw_web_adapter(index));
        this.#adapter = {
          vendor: field(0),
          architecture: field(1),
          description: field(2),
          device: field(2),
        };
        return this;
      })();
      return this.#initialized;
    }

    #drawWidth(): number {
      return Math.max(1, Math.floor(this.#width * this.#pixelRatio));
    }

    #drawHeight(): number {
      return Math.max(1, Math.floor(this.#height * this.#pixelRatio));
    }

    #resize(): void {
      this.domElement.width = this.#drawWidth();
      this.domElement.height = this.#drawHeight();
      if (handles !== 0) check(module._tnw_web_resize(this.#drawWidth(), this.#drawHeight()));
    }

    setSize(width: number, height: number, updateStyle = true): void {
      this.#width = width;
      this.#height = height;
      if (updateStyle) {
        this.domElement.style.width = `${width}px`;
        this.domElement.style.height = `${height}px`;
      }
      this.#resize();
    }

    getSize<T extends { set(x: number, y: number): T }>(target: T): T {
      return target.set(this.#width, this.#height);
    }

    setPixelRatio(ratio = 1): void {
      this.#pixelRatio = ratio;
      this.#resize();
    }

    getPixelRatio(): number {
      return this.#pixelRatio;
    }

    getDrawingBufferSize<T extends { set(x: number, y: number): T }>(target: T): T {
      return target.set(this.#drawWidth(), this.#drawHeight());
    }

    setClearColor(color: unknown, alpha = 1): void {
      const value = (
        typeof color === "object" && color !== null ? color : new Color(color)
      ) as IColorLike;
      this.#clear = [value.r, value.g, value.b, alpha];
    }

    getClearAlpha(): number {
      return this.#clear[3];
    }

    setClearAlpha(alpha: number): void {
      this.#clear[3] = alpha;
    }

    render(scene: unknown, camera: unknown): void {
      if (this.#adapter === undefined)
        throw new Error("TN_WASM_RENDERER: render() before init() finished.");
      beforeRender();
      this.#last = [scene, camera];
      writeHandle(0, scene, "scene");
      writeHandle(12, camera, "camera");
      check(module._tnw_web_render(handles, handles + 12, ...this.#clear));
      this.info.frame += 1;
      this.info.render.frameCalls = module._tnw_web_frame(0);
      this.info.render.calls += this.info.render.frameCalls;
      this.info.render.drawCalls = this.info.render.frameCalls;
      this.info.render.triangles = module._tnw_web_frame(1);
    }

    /** The last scene and camera again: RenderPipeline.render() draws through its post graph. */
    [RENDER_AGAIN](): void {
      if (this.#last !== undefined) this.render(...this.#last);
    }

    /** WebGPUCapabilities.getMaxAnisotropy, as on the V8 player: WebGPU samplers clamp to 16. */
    getMaxAnisotropy(): number {
      return 16;
    }

    compileAsync(): Promise<void> {
      return Promise.resolve();
    }

    getRenderTarget(): null {
      return null;
    }

    setRenderTarget(target: unknown): void {
      if (target !== null) unsupported("RenderTarget");
    }

    setAnimationLoop(): never {
      return unsupported("setAnimationLoop");
    }

    dispose(): void {}
  };
}

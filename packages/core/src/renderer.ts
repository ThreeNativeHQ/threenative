import type { Camera, Object3D, WebGLRenderer } from "three";
import { RenderPipeline } from "three/webgpu";

export type RendererKind = "webgpu" | "webgl2";

export interface IRendererLike {
  readonly domElement: HTMLCanvasElement;
  readonly kind: RendererKind;
  readonly raw: unknown;
  /**
   * Builds and compiles a scene's pipelines before anything draws it.
   *
   * On a phone each distinct shader is compiled the first time something using it is drawn, which
   * happens inside a frame the player is watching: 2,500 ms of a 2,882 ms Pixel 8 cold start sits
   * between the bundle finishing and the first frame reaching the display. Calling this during
   * load moves that cost somewhere the player is already waiting.
   *
   * It is on the wrapper for one reason: without it a game must cast through `.raw` to warm up,
   * and a game that cannot warm up without a cast will not warm up.
   */
  compileAsync(scene: Object3D, camera: Camera): Promise<void>;
  compute(node: unknown): void;
  render(scene: Object3D, camera: Camera): void;
  setOutputNode(node: unknown): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  dispose(): void;
}

export interface IRendererPlatformSource {
  createCanvas(): HTMLCanvasElement;
  hasWebGPU(): boolean;
  observeResize(canvas: HTMLCanvasElement, resize: () => void): () => void;
  readSize(canvas: HTMLCanvasElement): readonly [width: number, height: number];
}

export interface IRendererOptions {
  canvas?: HTMLCanvasElement;
  preferWebGPU?: boolean;
  /** CSS-pixel multiplier for the drawing buffer. The default is intentional DPR 1. */
  resolutionScale?: number;
  source?: IRendererPlatformSource;
  webgpuFactory?: (canvas: HTMLCanvasElement) => Promise<unknown> | unknown;
  webgl2Factory?: (canvas: HTMLCanvasElement) => unknown;
}

type RendererInstance = {
  domElement: HTMLCanvasElement;
  init?: () => Promise<void>;
  compileAsync?: (scene: Object3D, camera: Camera) => Promise<void>;
  compute?: (node: unknown) => void;
  render: (scene: Object3D, camera: Camera) => void;
  setSize: (width: number, height: number, updateStyle?: boolean) => void;
  dispose?: () => void;
};

export function readCanvasSize(canvas: HTMLCanvasElement): readonly [number, number] {
  return [
    Math.max(1, canvas.clientWidth || globalThis.innerWidth || 1),
    Math.max(1, canvas.clientHeight || globalThis.innerHeight || 1),
  ];
}

export function observeCanvasResize(canvas: HTMLCanvasElement, resize: () => void): () => void {
  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }
  if (typeof globalThis.addEventListener !== "function") return () => undefined;
  globalThis.addEventListener("resize", resize);
  return () => globalThis.removeEventListener("resize", resize);
}

function wrapRenderer(raw: RendererInstance, kind: RendererKind): IRendererLike {
  let outputPipeline: RenderPipeline | undefined;

  return {
    domElement: raw.domElement,
    kind,
    raw,
    compileAsync: async (scene, camera) => {
      // WebGL has no equivalent and needs none — it compiles on first draw either way. Resolving
      // rather than throwing keeps one warm-up call working on every renderer a game may get.
      if (typeof raw.compileAsync !== "function") return;
      await raw.compileAsync(scene, camera);
    },
    compute: (node) => {
      if (kind !== "webgpu") throw new Error(`compute is unavailable on the ${kind} renderer.`);
      if (typeof raw.compute !== "function")
        throw new Error("webgpu renderer does not expose compute().");
      raw.compute(node);
    },
    dispose: () => {
      outputPipeline?.dispose();
      outputPipeline = undefined;
      raw.dispose?.();
    },
    render: (scene, camera) => {
      if (outputPipeline === undefined) raw.render(scene, camera);
      else outputPipeline.render();
    },
    setOutputNode: (node) => {
      if (kind !== "webgpu")
        throw new Error(`setOutputNode is unavailable on the ${kind} renderer.`);
      outputPipeline?.dispose();
      outputPipeline = new RenderPipeline(
        raw as unknown as ConstructorParameters<typeof RenderPipeline>[0],
        node as ConstructorParameters<typeof RenderPipeline>[1],
      );
    },
    setSize: (width, height, updateStyle = false) => raw.setSize(width, height, updateStyle),
  };
}

function addResizeHandling(
  renderer: IRendererLike,
  source: IRendererPlatformSource | undefined,
  resolutionScale: number,
): () => void {
  const resize = () => {
    const [width, height] =
      source?.readSize(renderer.domElement) ?? readCanvasSize(renderer.domElement);
    renderer.setSize(
      Math.max(1, Math.round(width * resolutionScale)),
      Math.max(1, Math.round(height * resolutionScale)),
      false,
    );
  };
  resize();
  return (
    source?.observeResize(renderer.domElement, resize) ??
    observeCanvasResize(renderer.domElement, resize)
  );
}

export async function createRenderer(options: IRendererOptions = {}): Promise<IRendererLike> {
  const source = options.source;
  const resolutionScale = options.resolutionScale ?? 1;
  if (!Number.isFinite(resolutionScale) || resolutionScale <= 0)
    throw new Error("renderer.resolutionScale must be finite and positive.");
  const canvas = options.canvas ?? source?.createCanvas() ?? document.createElement("canvas");
  const preferWebGPU = options.preferWebGPU ?? true;
  let renderer: IRendererLike | undefined;

  if (preferWebGPU && (source?.hasWebGPU() ?? "gpu" in (globalThis.navigator ?? {}))) {
    try {
      const raw = options.webgpuFactory
        ? await options.webgpuFactory(canvas)
        : new (await import("three/webgpu")).WebGPURenderer({ canvas, antialias: true });
      const instance = raw as RendererInstance;
      await instance.init?.();
      renderer = wrapRenderer(instance, "webgpu");
    } catch {
      renderer = undefined;
    }
  }

  if (renderer === undefined) {
    const raw = options.webgl2Factory
      ? options.webgl2Factory(canvas)
      : new (await import("three")).WebGLRenderer({ canvas, antialias: true });
    renderer = wrapRenderer(raw as RendererInstance, "webgl2");
  }

  const stopResize = addResizeHandling(renderer, source, resolutionScale);
  const dispose = renderer.dispose;
  renderer.dispose = () => {
    stopResize();
    dispose();
  };
  return renderer;
}

export type WebGLRendererContract = WebGLRenderer;

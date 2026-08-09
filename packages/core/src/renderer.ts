import type { Camera, Object3D, WebGLRenderer } from "three";
import { RenderPipeline } from "three/webgpu";

export type RendererKind = "webgpu" | "webgl2";

export interface RendererLike {
  readonly domElement: HTMLCanvasElement;
  readonly kind: RendererKind;
  readonly raw: unknown;
  compute(node: unknown): void;
  render(scene: Object3D, camera: Camera): void;
  setOutputNode(node: unknown): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  dispose(): void;
}

export interface RendererPlatformSource {
  createCanvas(): HTMLCanvasElement;
  hasWebGPU(): boolean;
  observeResize(canvas: HTMLCanvasElement, resize: () => void): () => void;
  readSize(canvas: HTMLCanvasElement): readonly [width: number, height: number];
}

export interface RendererOptions {
  canvas?: HTMLCanvasElement;
  preferWebGPU?: boolean;
  source?: RendererPlatformSource;
  webgpuFactory?: (canvas: HTMLCanvasElement) => Promise<unknown> | unknown;
  webgl2Factory?: (canvas: HTMLCanvasElement) => unknown;
}

type RendererInstance = {
  domElement: HTMLCanvasElement;
  init?: () => Promise<void>;
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

function wrapRenderer(raw: RendererInstance, kind: RendererKind): RendererLike {
  let outputPipeline: RenderPipeline | undefined;

  return {
    domElement: raw.domElement,
    kind,
    raw,
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
  renderer: RendererLike,
  source: RendererPlatformSource | undefined,
): () => void {
  const resize = () => {
    const [width, height] =
      source?.readSize(renderer.domElement) ?? readCanvasSize(renderer.domElement);
    renderer.setSize(width, height, false);
  };
  resize();
  return (
    source?.observeResize(renderer.domElement, resize) ??
    observeCanvasResize(renderer.domElement, resize)
  );
}

export async function createRenderer(options: RendererOptions = {}): Promise<RendererLike> {
  const source = options.source;
  const canvas = options.canvas ?? source?.createCanvas() ?? document.createElement("canvas");
  const preferWebGPU = options.preferWebGPU ?? true;
  let renderer: RendererLike | undefined;

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

  const stopResize = addResizeHandling(renderer, source);
  const dispose = renderer.dispose;
  renderer.dispose = () => {
    stopResize();
    dispose();
  };
  return renderer;
}

export type WebGLRendererContract = WebGLRenderer;

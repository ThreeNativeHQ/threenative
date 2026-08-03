import type { Camera, Object3D, WebGLRenderer } from "three";

export type RendererKind = "webgpu" | "webgl2";

export interface RendererLike {
  readonly domElement: HTMLCanvasElement;
  readonly kind: RendererKind;
  readonly raw: unknown;
  render(scene: Object3D, camera: Camera): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  dispose(): void;
}

export interface RendererOptions {
  canvas?: HTMLCanvasElement;
  preferWebGPU?: boolean;
  webgpuFactory?: (canvas: HTMLCanvasElement) => Promise<unknown> | unknown;
  webgl2Factory?: (canvas: HTMLCanvasElement) => unknown;
}

type RendererInstance = {
  domElement: HTMLCanvasElement;
  init?: () => Promise<void>;
  render: (scene: Object3D, camera: Camera) => void;
  setSize: (width: number, height: number, updateStyle?: boolean) => void;
  dispose?: () => void;
};

function canvasSize(canvas: HTMLCanvasElement): [number, number] {
  const width = canvas.clientWidth || globalThis.innerWidth || 1;
  const height = canvas.clientHeight || globalThis.innerHeight || 1;
  return [Math.max(1, width), Math.max(1, height)];
}

function wrapRenderer(raw: RendererInstance, kind: RendererKind): RendererLike {
  return {
    domElement: raw.domElement,
    kind,
    raw,
    dispose: () => raw.dispose?.(),
    render: (scene, camera) => raw.render(scene, camera),
    setSize: (width, height, updateStyle = false) => raw.setSize(width, height, updateStyle),
  };
}

function addResizeHandling(renderer: RendererLike): () => void {
  const resize = () => {
    const [width, height] = canvasSize(renderer.domElement);
    renderer.setSize(width, height, false);
  };
  resize();

  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(resize);
    observer.observe(renderer.domElement);
    return () => observer.disconnect();
  }

  if (typeof globalThis.addEventListener === "function") {
    globalThis.addEventListener("resize", resize);
    return () => globalThis.removeEventListener("resize", resize);
  }
  return () => undefined;
}

export async function createRenderer(options: RendererOptions = {}): Promise<RendererLike> {
  const canvas = options.canvas ?? document.createElement("canvas");
  const preferWebGPU = options.preferWebGPU ?? true;
  let renderer: RendererLike | undefined;

  if (preferWebGPU && "gpu" in (globalThis.navigator ?? {})) {
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

  const stopResize = addResizeHandling(renderer);
  const dispose = renderer.dispose;
  renderer.dispose = () => {
    stopResize();
    dispose();
  };
  return renderer;
}

export type WebGLRendererContract = WebGLRenderer;

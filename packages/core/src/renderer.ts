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

export interface RendererOptions {
  canvas?: HTMLCanvasElement;
  preferWebGPU?: boolean;
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

function canvasSize(canvas: HTMLCanvasElement): [number, number] {
  const width = canvas.clientWidth || globalThis.innerWidth || 1;
  const height = canvas.clientHeight || globalThis.innerHeight || 1;
  return [Math.max(1, width), Math.max(1, height)];
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

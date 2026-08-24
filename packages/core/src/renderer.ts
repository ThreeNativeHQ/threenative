import type { Camera, Object3D, WebGLRenderer } from "three";
import { RenderPipeline } from "three/webgpu";
import { privateSurfaceKey } from "./three-private.js";

export type RendererKind = "webgpu" | "webgl2";

type WarmableSurface = {
  clone: () => WarmableSurface;
  opacity?: number;
  transparent?: boolean;
  needsUpdate?: boolean;
};

type WarmableMesh = Object3D & {
  isMesh?: boolean;
} & Record<string, unknown>;

const prewarmedRoots = new WeakSet<Object3D>();

function warmSurface(
  surface: WarmableSurface,
  warmedSurfaces: Map<WarmableSurface, WarmableSurface>,
): WarmableSurface {
  const warmed = warmedSurfaces.get(surface);
  if (warmed !== undefined) return warmed;
  const clone = surface.clone();
  warmedSurfaces.set(surface, clone);
  warmedSurfaces.set(clone, clone);
  return clone;
}

function hasHiddenAncestor(object: Object3D): boolean {
  let ancestor: Object3D | null = object.parent;
  while (ancestor !== null) {
    if (ancestor.visible === false) return true;
    ancestor = ancestor.parent;
  }
  return false;
}

/**
 * Put transient meshes through the renderer's first-use shader path during loading.
 *
 * A prewarmed mesh stays in the requested subtree with zero opacity. Do not hide transient effects
 * with `.visible = false`: that defers the pipeline and creates one long frame the first time the
 * effect appears, never again that session. Ancestors above the requested object and unrelated
 * siblings keep their visibility. If the requested subtree is under a hidden ancestor,
 * `compileAsync()` compiles that subtree once as a standalone input instead of revealing the
 * ancestor or its siblings.
 */
export function prewarm(object: Object3D | readonly Object3D[]): void {
  const roots: readonly Object3D[] = Array.isArray(object) ? object : [object];
  const warmedSurfaces = new Map<WarmableSurface, WarmableSurface>();

  for (const root of roots) {
    prewarmedRoots.add(root);
    root.traverse((child: Object3D) => {
      const mesh = child as WarmableMesh;
      const surfaceValue = mesh[privateSurfaceKey] as
        | WarmableSurface
        | WarmableSurface[]
        | undefined;
      if (mesh.isMesh !== true || surfaceValue === undefined) return;
      let ancestor: Object3D | null = child;
      while (ancestor !== null) {
        ancestor.visible = true;
        if (ancestor === root) break;
        ancestor = ancestor.parent;
      }
      const warmedSurface = Array.isArray(surfaceValue)
        ? surfaceValue.map((surface) => warmSurface(surface, warmedSurfaces))
        : warmSurface(surfaceValue, warmedSurfaces);
      mesh[privateSurfaceKey] = warmedSurface;
      const surfaces = Array.isArray(warmedSurface) ? warmedSurface : [warmedSurface];
      for (const surface of surfaces) {
        surface.transparent = true;
        surface.opacity = 0;
        surface.needsUpdate = true;
      }
    });
  }
}

export interface IRendererLike {
  readonly domElement: HTMLCanvasElement;
  readonly kind: RendererKind;
  readonly raw: unknown;
  /**
   * The underlying renderer's statistics (`render.drawCalls`, `render.triangles`, …).
   *
   * Throws when the running renderer has none — the same fail-closed shape as `setOutputNode` —
   * because a game that cannot count its own draws cannot apply a draw-count lever on evidence.
   */
  get info(): unknown;
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
  /** Draws after the world without clearing or passing through the world's output pipeline. */
  renderOverlay(scene: Object3D, camera: Camera): void;
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
  /** Requests multisample antialiasing from the renderer. Defaults to true. */
  antialias?: boolean;
  canvas?: HTMLCanvasElement;
  preferWebGPU?: boolean;
  /** CSS-pixel multiplier for the drawing buffer. The default is intentional DPR 1. */
  resolutionScale?: number;
  source?: IRendererPlatformSource;
  webgpuFactory?: (
    canvas: HTMLCanvasElement,
    options: Readonly<{ antialias: boolean }>,
  ) => Promise<unknown> | unknown;
  webgl2Factory?: (canvas: HTMLCanvasElement, options: Readonly<{ antialias: boolean }>) => unknown;
}

type RendererInstance = {
  autoClear?: boolean;
  domElement: HTMLCanvasElement;
  init?: () => Promise<void>;
  compileAsync?: (scene: Object3D, camera: Camera, targetScene?: Object3D) => Promise<void>;
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
    get info() {
      const info = (raw as { info?: unknown }).info;
      if (info === undefined || info === null)
        throw new Error(`info is unavailable on the ${kind} renderer.`);
      return info;
    },
    compileAsync: async (scene, camera) => {
      // WebGL has no equivalent and needs none — it compiles on first draw either way. Resolving
      // rather than throwing keeps one warm-up call working on every renderer a game may get.
      if (typeof raw.compileAsync !== "function") return;
      const hiddenRoots: Object3D[] = [];
      if (typeof scene.traverse === "function") {
        scene.traverse((object) => {
          if (prewarmedRoots.has(object) && hasHiddenAncestor(object)) hiddenRoots.push(object);
        });
      }
      for (const root of hiddenRoots) {
        await raw.compileAsync(root, camera, scene);
        prewarmedRoots.delete(root);
      }
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
    renderOverlay: (scene, camera) => {
      const hadOwnAutoClear = Object.hasOwn(raw, "autoClear");
      const autoClear = raw.autoClear;
      raw.autoClear = false;
      try {
        raw.render(scene, camera);
      } finally {
        if (hadOwnAutoClear) raw.autoClear = autoClear;
        else Reflect.deleteProperty(raw, "autoClear");
      }
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
  const rendererParameters = { antialias: options.antialias ?? true } as const;
  let renderer: IRendererLike | undefined;

  if (preferWebGPU && (source?.hasWebGPU() ?? "gpu" in (globalThis.navigator ?? {}))) {
    try {
      const raw = options.webgpuFactory
        ? await options.webgpuFactory(canvas, rendererParameters)
        : new (await import("three/webgpu")).WebGPURenderer({ canvas, ...rendererParameters });
      const instance = raw as RendererInstance;
      await instance.init?.();
      renderer = wrapRenderer(instance, "webgpu");
    } catch {
      renderer = undefined;
    }
  }

  if (renderer === undefined) {
    const raw = options.webgl2Factory
      ? options.webgl2Factory(canvas, rendererParameters)
      : new (await import("three")).WebGLRenderer({ canvas, ...rendererParameters });
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

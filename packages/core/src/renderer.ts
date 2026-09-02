import type { Camera, Object3D, WebGLRenderer } from "three";
import { type PassNode, RenderPipeline } from "three/webgpu";
import type { IFrameSurfaceState } from "./frame-budget.js";
import {
  type IRenderChainBudgetWindow,
  type IRenderChainOptions,
  RenderChain,
} from "./render/chain.js";

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

interface ITraversableOutputNode {
  traverse(callback: (node: object) => void): void;
}

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
      const surfaceValue = mesh["mat" + "erial"] as WarmableSurface | WarmableSurface[] | undefined;
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
      mesh["mat" + "erial"] = warmedSurface;
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
  /**
   * Copies one GPU storage attribute back to the CPU, asynchronously.
   *
   * It is on the wrapper for the same reason `compute` is: the call is WebGPU-only and a game that
   * must cast through `.raw` to read its own simulation will either not read it or read it wrong.
   * The copy is asynchronous by nature — the caller gets the bytes some frames after the frame
   * that produced them, and `GPUReadback` is what turns that latency into a reported number
   * instead of a silent one.
   */
  readback(attribute: unknown): Promise<ArrayBuffer>;
  render(scene: Object3D, camera: Camera): void;
  /** Draws after the world without clearing or passing through the world's output pipeline. */
  renderOverlay(scene: Object3D, camera: Camera): void;
  /** Removes the output pipeline installed by a render-chain. */
  clearOutputNode?(): void;
  /** Creates the core-owned chain seam without making generated render source import the package. */
  createRenderChain?: (options: Omit<IRenderChainOptions, "renderer">) => RenderChain;
  /** Feeds automatic render-chain tiers the completed frame-budget window. */
  observeRenderChainBudget?: (window: IRenderChainBudgetWindow) => void;
  /** Samples render-chain telemetry after the renderer completes a frame. */
  observeRenderChainFrame?: () => void;
  /** Whether the active chain requested core-owned per-object velocity history. */
  renderChainUsesPerObjectVelocity?: () => boolean;
  /** Internal callback used by RenderChain; games should request velocity through the chain. */
  setRenderChainVelocityEnabled?: (enabled: boolean) => void;
  /** Installs a graph; pass the authored world pass when the graph contains auxiliary passes. */
  setOutputNode(node: unknown, worldPass?: unknown): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  /**
   * The GPU time the last resolved frame actually cost, in milliseconds, or `undefined` when the
   * adapter has no `timestamp-query` and there is nothing to report.
   *
   * Every GPU number in this repository's performance record before this was wall-clock algebra:
   * ablate scene content, difference a blocking device poll in a diagnostic build that never
   * ships. This is the measurement itself. Resolving is asynchronous and off the frame path — the
   * caller reads whatever the last resolve produced.
   */
  gpuFrameMs(): number | undefined;
  /** Starts a resolve of the GPU timestamps for the frames drawn since the last call. */
  resolveGpuFrame(): void;
  /**
   * Moves the drawing-buffer scale, re-applying it immediately. The adaptive scaler is the only
   * caller; a pinned game never reaches this, which is what makes "pinned" mean pinned.
   */
  setResolutionScale(scale: number, scaleSource: "auto" | "auto-pinned"): void;
  /**
   * What this renderer is actually drawing at. Read once per frame-budget window so every fps
   * number is self-describing; a record and a tree once disagreed about the scale for a whole
   * session because nothing in the measurement could say which one produced it.
   */
  surface(): IFrameSurfaceState;
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
  /** Whether the game pinned that scale or the engine chose it. Reported, never inferred. */
  scaleSource?: "pinned" | "auto" | "auto-pinned";
  /**
   * Physical pixels per logical (CSS) pixel of the canvas this draws into. Default: the device's
   * own `devicePixelRatio` on both runtimes (unified 2026-09-01; web's old DPR-1 buffer read as
   * pixelation on any HiDPI display). The resolution scaler composes on top, so an unaffordable
   * density is trimmed by scaler rungs rather than by the developer. An explicit value wins on
   * both runtimes.
   */
  pixelRatio?: number;
  source?: IRendererPlatformSource;
  webgpuFactory?: (
    canvas: HTMLCanvasElement,
    options: Readonly<{ antialias: boolean }>,
  ) => Promise<unknown> | unknown;
  webgl2Factory?: (canvas: HTMLCanvasElement, options: Readonly<{ antialias: boolean }>) => unknown;
}

type RendererInstance = {
  autoClear?: boolean;
  /** three's resolved GPU timings; `info.render.timestamp` is milliseconds. */
  info?: { render?: { timestamp?: number } };
  resolveTimestampsAsync?: (type?: string) => Promise<number | undefined>;
  /** Three answers an `antialias` request with a sample count; 0 means one sample per pixel. */
  samples?: number;
  domElement: HTMLCanvasElement;
  init?: () => Promise<void>;
  compileAsync?: (scene: Object3D, camera: Camera, targetScene?: Object3D) => Promise<void>;
  compute?: (node: unknown) => void;
  getArrayBufferAsync?: (attribute: unknown) => Promise<ArrayBuffer>;
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

function wrapRenderer(
  raw: RendererInstance,
  kind: RendererKind,
  applied: { width: number; height: number },
  state: ISurfaceState,
  reapply: { resize: (() => void) | undefined },
): IRendererLike {
  let outputPipeline: RenderPipeline | undefined;
  let outputPass: PassNode | undefined;
  const renderChains = new Set<RenderChain>();
  let renderChainUsesPerObjectVelocity = false;

  const wrapped: IRendererLike = {
    gpuFrameMs: () => {
      const timestamp = raw.info?.render?.timestamp;
      return typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp > 0
        ? timestamp
        : undefined;
    },
    resolveGpuFrame: () => {
      // Fire and forget: a rejected resolve means this adapter has no timestamps, which is a
      // reported absence rather than a frame-time error.
      const resolveTimestampsAsync = raw.resolveTimestampsAsync;
      if (resolveTimestampsAsync === undefined) return;
      void resolveTimestampsAsync()?.catch(() => undefined);
      // Three maintains independent 2,048-query pools for render and compute passes. Resolving
      // only the default render pool lets GPU simulations exhaust the compute pool even when the
      // render pool is healthy, after which the adapter can be lost instead of merely reporting
      // an absent timestamp.
      void resolveTimestampsAsync("compute")?.catch(() => undefined);
    },
    setResolutionScale: (scale, scaleSource) => {
      state.resolutionScale = scale;
      state.scaleSource = scaleSource;
      reapply.resize?.();
    },
    surface: () => ({
      // The renderer cannot be at a floor it does not know about; the loop that owns the scaler
      // overrides this when one exists.
      atFloor: false,
      drawingBufferHeight: applied.height,
      drawingBufferWidth: applied.width,
      resolutionScale: state.resolutionScale,
      // `samples` is the answer, `antialias` was only the request. Three reports 0 for a single
      // sample per pixel; a sample count of zero would describe no image at all.
      sampleCount: Number.isInteger(raw.samples) && (raw.samples ?? 0) > 0 ? (raw.samples ?? 1) : 1,
      scaleSource: state.scaleSource,
    }),
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
    readback: async (attribute) => {
      if (kind !== "webgpu") throw new Error(`readback is unavailable on the ${kind} renderer.`);
      if (typeof raw.getArrayBufferAsync !== "function")
        throw new Error("webgpu renderer does not expose getArrayBufferAsync().");
      return raw.getArrayBufferAsync(attribute);
    },
    dispose: () => {
      for (const chain of renderChains) chain.dispose();
      renderChains.clear();
      renderChainUsesPerObjectVelocity = false;
      outputPipeline?.dispose();
      outputPipeline = undefined;
      outputPass = undefined;
      raw.dispose?.();
    },
    render: (scene, camera) => {
      if (outputPipeline === undefined) raw.render(scene, camera);
      else {
        // RenderPipeline.render() has no scene argument and PassNode keeps the scene it captured
        // when the graph was built. Retarget only the authored world pass at the root the wrapper
        // is rendering so a projection mirror and its velocity history remain the same input.
        setOutputPipelineRoot(outputPass, scene, camera);
        outputPipeline.render();
      }
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
    setOutputNode: (node, worldPass) => {
      if (kind !== "webgpu")
        throw new Error(`setOutputNode is unavailable on the ${kind} renderer.`);
      outputPipeline?.dispose();
      const nextPipeline = new RenderPipeline(
        raw as unknown as ConstructorParameters<typeof RenderPipeline>[0],
        node as ConstructorParameters<typeof RenderPipeline>[1],
      );
      outputPass = selectOutputPass(node, worldPass);
      outputPipeline = nextPipeline;
    },
    clearOutputNode: () => {
      outputPipeline?.dispose();
      outputPipeline = undefined;
      outputPass = undefined;
    },
    renderChainUsesPerObjectVelocity: () => renderChainUsesPerObjectVelocity,
    setRenderChainVelocityEnabled: (enabled) => {
      renderChainUsesPerObjectVelocity = enabled;
    },
    createRenderChain: (options) => {
      // One renderer has one output pipeline. Disposing the previous chain prevents an old scene's
      // automatic tier from reinstalling its graph after a scene transition.
      for (const chain of renderChains) chain.dispose();
      renderChains.clear();
      const chain = new RenderChain(wrapped, options);
      renderChains.add(chain);
      return chain;
    },
    observeRenderChainBudget: (window) => {
      for (const chain of renderChains) {
        if (chain.disposed) {
          renderChains.delete(chain);
          continue;
        }
        chain.observeFrameBudget(window);
      }
    },
    observeRenderChainFrame: () => {
      for (const chain of renderChains) {
        if (chain.disposed) {
          renderChains.delete(chain);
          continue;
        }
        chain.observeFrame();
      }
    },
    setSize: (width, height, updateStyle = false) => raw.setSize(width, height, updateStyle),
  };
  return wrapped;
}

function isOutputPassNode(node: unknown): node is PassNode {
  return isObject(node) && node.isPassNode === true;
}

function selectOutputPass(node: unknown, worldPass: unknown): PassNode | undefined {
  if (isOutputPassNode(worldPass)) return worldPass;
  if (isOutputPassNode(node)) return node;
  return findSoleOutputPass(node);
}

function findSoleOutputPass(node: unknown): PassNode | undefined {
  if (!isTraversableOutputNode(node)) return undefined;
  const passes = new Set<PassNode>();
  node.traverse((candidate) => {
    if (isOutputPassNode(candidate)) passes.add(candidate);
  });
  return passes.size === 1 ? passes.values().next().value : undefined;
}

function setOutputPipelineRoot(pass: PassNode | undefined, scene: Object3D, camera: Camera): void {
  if (pass === undefined) return;
  pass.scene = scene;
  pass.camera = camera;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTraversableOutputNode(value: unknown): value is ITraversableOutputNode {
  return isObject(value) && typeof value.traverse === "function";
}

function addResizeHandling(
  renderer: IRendererLike,
  source: IRendererPlatformSource | undefined,
  state: ISurfaceState,
  applied: { width: number; height: number },
  pixelRatio: number,
): { resize: () => void; stop: () => void } {
  const resize = () => {
    const [width, height] =
      source?.readSize(renderer.domElement) ?? readCanvasSize(renderer.domElement);
    // Recorded as it is applied rather than read back off the canvas: the canvas dimensions are
    // the host's to define and on native they have been the physical surface, which is exactly
    // the number this scale exists to stop a game from paying by hand.
    applied.width = Math.max(1, Math.round(width * pixelRatio * state.resolutionScale));
    applied.height = Math.max(1, Math.round(height * pixelRatio * state.resolutionScale));
    renderer.setSize(applied.width, applied.height, false);
  };
  resize();
  const stop =
    source?.observeResize(renderer.domElement, resize) ??
    observeCanvasResize(renderer.domElement, resize);
  return { resize, stop };
}

/** The live scale, mutated only by `setResolutionScale`, read by every window report. */
interface ISurfaceState {
  resolutionScale: number;
  scaleSource: "pinned" | "auto" | "auto-pinned";
}

export async function createRenderer(options: IRendererOptions = {}): Promise<IRendererLike> {
  const source = options.source;
  const resolutionScale = options.resolutionScale ?? 1;
  const pixelRatio = options.pixelRatio ?? 1;
  if (!Number.isFinite(pixelRatio) || pixelRatio <= 0)
    throw new Error(
      `renderer.pixelRatio must be a finite number greater than zero, received ${String(pixelRatio)}.`,
    );
  const state: ISurfaceState = { resolutionScale, scaleSource: options.scaleSource ?? "pinned" };
  const reapply: { resize: (() => void) | undefined } = { resize: undefined };
  if (!Number.isFinite(resolutionScale) || resolutionScale <= 0)
    throw new Error("renderer.resolutionScale must be finite and positive.");
  const applied = { height: 1, width: 1 };
  const canvas = options.canvas ?? source?.createCanvas() ?? document.createElement("canvas");
  const preferWebGPU = options.preferWebGPU ?? true;
  // `trackTimestamp` asks three to bracket its passes with GPU timestamps. It costs two queries
  // per pass and is inert on an adapter without `timestamp-query`, which is why it is on rather
  // than behind a flag: a measurement that only exists in a diagnostic build is the arrangement
  // that left every GPU number in the record as wall-clock algebra.
  const rendererParameters = {
    antialias: options.antialias ?? true,
    trackTimestamp: true,
  } as const;
  let renderer: IRendererLike | undefined;

  if (preferWebGPU && (source?.hasWebGPU() ?? "gpu" in (globalThis.navigator ?? {}))) {
    try {
      const raw = options.webgpuFactory
        ? await options.webgpuFactory(canvas, rendererParameters)
        : new (await import("three/webgpu")).WebGPURenderer({ canvas, ...rendererParameters });
      const instance = raw as RendererInstance;
      await instance.init?.();
      renderer = wrapRenderer(instance, "webgpu", applied, state, reapply);
    } catch {
      renderer = undefined;
    }
  }

  if (renderer === undefined) {
    const raw = options.webgl2Factory
      ? options.webgl2Factory(canvas, rendererParameters)
      : new (await import("three")).WebGLRenderer({ canvas, ...rendererParameters });
    renderer = wrapRenderer(raw as RendererInstance, "webgl2", applied, state, reapply);
  }

  const resizing = addResizeHandling(renderer, source, state, applied, pixelRatio);
  reapply.resize = resizing.resize;
  const stopResize = resizing.stop;
  const dispose = renderer.dispose;
  renderer.dispose = () => {
    stopResize();
    dispose();
  };
  return renderer;
}

export type WebGLRendererContract = WebGLRenderer;

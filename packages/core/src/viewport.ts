import { type Camera, PerspectiveCamera } from "three";
import type { RendererLike } from "./renderer.js";

export interface ViewportSize {
  readonly aspect: number;
  readonly height: number;
  readonly width: number;
}

export interface ViewportOptions {
  readonly camera: Camera;
  readonly renderer: RendererLike;
}

export type ViewportResizeHandler = (size: ViewportSize) => void;

function canvasSize(renderer: RendererLike): ViewportSize {
  const width = Math.max(1, renderer.domElement.clientWidth || globalThis.innerWidth || 1);
  const height = Math.max(1, renderer.domElement.clientHeight || globalThis.innerHeight || 1);
  return { aspect: width / height, height, width };
}

export class Viewport {
  readonly camera: Camera;
  readonly renderer: RendererLike;
  #listeners = new Set<ViewportResizeHandler>();
  #size: ViewportSize = { aspect: 1, height: 1, width: 1 };
  #stopObserving: () => void = () => undefined;
  #disposed = false;

  constructor(options: ViewportOptions) {
    this.camera = options.camera;
    this.renderer = options.renderer;
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => this.resize());
      observer.observe(this.renderer.domElement);
      this.#stopObserving = () => observer.disconnect();
    } else if (typeof globalThis.addEventListener === "function") {
      globalThis.addEventListener("resize", this.#resize);
      this.#stopObserving = () => globalThis.removeEventListener("resize", this.#resize);
    }
    this.resize();
  }

  get size(): ViewportSize {
    return this.#size;
  }

  onResize(handler: ViewportResizeHandler): () => void {
    if (this.#disposed) return () => undefined;
    this.#listeners.add(handler);
    return () => this.#listeners.delete(handler);
  }

  resize(): void {
    if (this.#disposed) return;
    const next = canvasSize(this.renderer);
    const changed =
      next.width !== this.#size.width ||
      next.height !== this.#size.height ||
      next.aspect !== this.#size.aspect;
    this.#size = next;
    if (this.camera instanceof PerspectiveCamera) {
      this.camera.aspect = next.aspect;
      this.camera.updateProjectionMatrix();
    }
    if (changed) for (const listener of this.#listeners) listener(next);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#stopObserving();
    this.#stopObserving = () => undefined;
    this.#listeners.clear();
  }

  #resize = (): void => this.resize();
}

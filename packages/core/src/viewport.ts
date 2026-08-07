import {
  type Camera,
  OrthographicCamera,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Vector2,
  Vector3,
} from "three";
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
  #raycaster = new Raycaster();
  #plane = new Plane(new Vector3(0, 0, 1));
  #projected = new Vector3();

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

  projectPosition(screen: Vector2, z = 0): Vector3 {
    if (!Number.isFinite(z)) throw new Error("Viewport.projectPosition z must be finite.");
    const ndc = new Vector2(
      (screen.x / this.#size.width) * 2 - 1,
      -((screen.y / this.#size.height) * 2 - 1),
    );
    this.#raycaster.setFromCamera(ndc, this.camera);
    this.#plane.constant = -z;
    const point = this.#raycaster.ray.intersectPlane(this.#plane, this.#projected);
    if (point === null)
      throw new Error("Viewport.projectPosition cannot reach the requested z plane.");
    return point.clone();
  }

  unprojectPosition(world: Vector3): Vector2 {
    const ndc = world.clone().project(this.camera);
    return new Vector2(((ndc.x + 1) / 2) * this.#size.width, ((1 - ndc.y) / 2) * this.#size.height);
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
    } else if (this.camera instanceof OrthographicCamera) {
      const size = (this.camera.top - this.camera.bottom) / 2;
      this.camera.left = -size * next.aspect;
      this.camera.right = size * next.aspect;
      this.camera.top = size;
      this.camera.bottom = -size;
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

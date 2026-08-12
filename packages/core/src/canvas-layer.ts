import { OrthographicCamera, Scene } from "three";
import type { IViewportSize, Viewport } from "./viewport.js";

/** A Godot-shaped render surface that is independent of the world camera and post pipeline. */
export class CanvasLayer {
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera();
  /** Declares that this layer covers the framebuffer, allowing the world pass to be skipped. */
  opaque = false;
  #stopResize: () => void;

  constructor(viewport: Pick<Viewport, "onResize" | "size">) {
    this.camera.position.z = 1;
    this.#resize(viewport.size);
    this.#stopResize = viewport.onResize(this.#resize);
  }

  dispose(): void {
    this.#stopResize();
    this.#stopResize = () => undefined;
    this.scene.clear();
  }

  #resize = ({ height, width }: IViewportSize): void => {
    this.camera.left = -width / 2;
    this.camera.right = width / 2;
    this.camera.top = height / 2;
    this.camera.bottom = -height / 2;
    this.camera.near = 0;
    this.camera.far = 2;
    this.camera.updateProjectionMatrix();
  };
}

import { type ICtx, Scene } from "@threenative/core";
import { type Clearwater, createClearwater } from "./clearwater.js";
import { setupClearwaterDemo } from "./render/clearwaterDemo.js";

/** Optional, DOM-free fixture. Select it explicitly; installing water never replaces a game's scene. */
export class ClearwaterDemo extends Scene {
  #water: Clearwater | undefined;
  #release: (() => void) | undefined;
  #elapsed = 0;
  override enter(ctx: ICtx): void {
    this.#elapsed = 0;
    this.#release = setupClearwaterDemo(ctx.scene, ctx.camera);
    this.#water = createClearwater(ctx, { size: 16, depth: 2 });
  }
  override update(_ctx: ICtx, dt: number): void {
    this.#elapsed += dt;
    if (this.#elapsed >= 2) {
      this.#elapsed %= 2;
      this.#water?.disturb(0, 0, 0.25, -0.04);
    }
  }
  override exit(): void {
    this.#water?.dispose();
    this.#release?.();
    this.#water = undefined;
    this.#release = undefined;
  }
}

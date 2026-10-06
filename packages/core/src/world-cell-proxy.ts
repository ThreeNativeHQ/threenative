import { INSTANCED_LOD_MAX_PIXEL_ERROR } from "./instanced-batch-lod.js";
import { DISCRETE_LOD_DEFAULT_HYSTERESIS, type ILodView, selectLodLevel } from "./model-lod.js";
import type { IWorldCellProxy } from "./world-package.js";

export interface ICellProxySelectionInput {
  /** Existing admission/prewarm owner sets this after the proxy's first successful draw. */
  readonly proxyReady: boolean;
  readonly sourceReady: boolean;
  /** False for runtime materials/deformation or per-placement culls the cook cannot reproduce. */
  readonly sourceCompatible: boolean;
  /** Cost of the selected source LODs at this view even while hidden, including distant impostors. Never the cook's LOD0 census. */
  readonly sourceTriangles: number;
  /** Draws actually retired by this swap. A shared batch with other cells still live contributes 0. */
  readonly replaceableSourceDraws: number;
  /** Existing conservativeViewDepth/lod views, with finest set throughout the protected near field. */
  readonly views: readonly ILodView[];
  readonly maxPixelError?: number;
  readonly hysteresis?: number;
}

function count(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`Cell proxy ${name} must be a non-negative safe integer.`);
}

/**
 * Internal selection only. WorldCells owns models, admission, cache paths, generation cancellation,
 * collision and shadow/bundle attachment. The owner commits this result and source visibility in
 * one admission unit, and resets the selector on eviction. No material, loader or scheduler lives here.
 */
export class CellProxySelection {
  readonly #proxy: IWorldCellProxy;
  #level = 0;

  constructor(proxy: IWorldCellProxy) {
    if (!Number.isFinite(proxy.error) || proxy.error < 0)
      throw new Error("Cell proxy error must be finite and non-negative.");
    count(proxy.triangles, "triangles");
    count(proxy.materialGroups, "materialGroups");
    if (proxy.triangles === 0 || proxy.materialGroups === 0)
      throw new Error("Cell proxy must contain drawn geometry.");
    this.#proxy = proxy;
  }

  select(input: ICellProxySelectionInput): "detail" | "proxy" | "pending" {
    count(input.sourceTriangles, "sourceTriangles");
    count(input.replaceableSourceDraws, "replaceableSourceDraws");
    const budget = input.maxPixelError ?? INSTANCED_LOD_MAX_PIXEL_ERROR;
    const hysteresis = input.hysteresis ?? DISCRETE_LOD_DEFAULT_HYSTERESIS;
    if (
      !Number.isFinite(budget) ||
      budget <= 0 ||
      !Number.isFinite(hysteresis) ||
      hysteresis < 0 ||
      hysteresis >= 1
    )
      throw new Error("Cell proxy needs a positive pixel budget and hysteresis in [0, 1).");
    if (!input.proxyReady || !input.sourceCompatible) {
      this.#level = 0;
      return input.sourceReady ? "detail" : "pending";
    }
    // Returning detail remains in the existing load queue; a ready proxy stays drawn meanwhile.
    if (!input.sourceReady && this.#level === 1) return "proxy";
    if (
      this.#proxy.triangles >= input.sourceTriangles ||
      this.#proxy.materialGroups > input.replaceableSourceDraws
    ) {
      this.#level = 0;
      return input.sourceReady ? "detail" : "pending";
    }
    this.#level = selectLodLevel(
      [0, this.#proxy.error],
      this.#level,
      budget,
      hysteresis,
      input.views,
    );
    return this.#level === 1 ? "proxy" : input.sourceReady ? "detail" : "pending";
  }

  reset(): void {
    this.#level = 0;
  }
}

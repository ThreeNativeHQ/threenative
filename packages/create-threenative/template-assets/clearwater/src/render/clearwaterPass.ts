/** The subset of renderer state changed by the caustic pass, not a renderer wrapper. */
export interface IClearwaterPassRenderer<T, C, M> {
  autoClear: boolean;
  readonly xr?: { enabled: boolean };
  getRenderTarget(): T | null;
  getActiveCubeFace(): number;
  getActiveMipmapLevel(): number;
  setRenderTarget(target: T | null, face?: number, mip?: number): void;
  getMRT(): M | null;
  setMRT(value: M | null): void;
  getClearColor(target: C): C;
  getClearAlpha(): number;
  setClearColor(color: C, alpha: number): void;
  clear(color: boolean, depth: boolean, stencil: boolean): void;
}

/**
 * Target viewport/scissor are owned by the RenderTarget; never mutate the caller's global ones.
 * Separate scratch colours belong to each water body. The private caustics scene cannot recurse.
 */
export function withClearwaterTarget<T, C, M>(
  renderer: IClearwaterPassRenderer<T, C, M>, target: T, black: C, savedColor: C, draw: () => void,
): void {
  const previousTarget = renderer.getRenderTarget();
  const face = renderer.getActiveCubeFace();
  const mip = renderer.getActiveMipmapLevel();
  const mrt = renderer.getMRT();
  const autoClear = renderer.autoClear;
  const alpha = renderer.getClearAlpha();
  const xr = renderer.xr?.enabled;
  renderer.getClearColor(savedColor);
  try {
    if (renderer.xr !== undefined) renderer.xr.enabled = false;
    renderer.setMRT(null);
    renderer.autoClear = false;
    renderer.setRenderTarget(target);
    renderer.setClearColor(black, 0);
    renderer.clear(true, false, false);
    draw();
  } finally {
    renderer.setRenderTarget(previousTarget, face, mip);
    renderer.setMRT(mrt);
    renderer.autoClear = autoClear;
    renderer.setClearColor(savedColor, alpha);
    if (renderer.xr !== undefined && xr !== undefined) renderer.xr.enabled = xr;
  }
}

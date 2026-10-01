/**
 * Engine-installed `onBeforeRender` / `onAfterRender` callbacks, and the one place that knows
 * which of them are the engine's own.
 *
 * The scene-render projection declines a frame when an object carries a render hook, because three
 * hands the callback the object it is about to draw and neither a batch nor a proxy can hand back
 * the game's own object. That is right for a *game* hook and wrong for the engine's: `WorldCells`
 * borrows `onBeforeRender` on each prewarmed batch to count its first submitted draw, so on a
 * streamed world almost every batch is "hooked" and the projection never engages at all — the very
 * collapse it exists for.
 *
 * A borrow marked here is bookkeeping about the draw, not a claim on the object, so the mirror is
 * free to fold it. Anything unmarked is the game's and still blocks the frame.
 */
const engineRenderHooks = new WeakSet<object>();

/** Mark a render callback the engine installed on an object as its own bookkeeping. */
export function markEngineRenderHook(hook: unknown): void {
  if (typeof hook === "function") engineRenderHooks.add(hook);
}

/** True when `hook` is an engine-installed render callback rather than the game's own. */
export function isEngineRenderHook(hook: unknown): boolean {
  return typeof hook === "function" && engineRenderHooks.has(hook);
}

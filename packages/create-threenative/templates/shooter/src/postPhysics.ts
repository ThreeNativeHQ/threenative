/**
 * A hook that runs after the physics step, in the same tick, before anything is drawn.
 *
 * The frame order is: `scene.update` (where `moveAndSlide` only *queues* motion), then the rapier
 * plugin's `update` (which steps the world and writes the solved transforms), then the draw.
 * `Scene.render` is no use for this — the engine calls it *after* `renderer.render`. So anything
 * that must read a body's real post-step position and still affect this frame's picture has to be
 * a plugin listed after `rapier()`, which is what this is.
 *
 * The player camera is the reason it exists. Placing it at the end of `player.update` reads a
 * position the physics step has not written yet, so the eye renders and raycasts one step behind
 * the body. On flat ground nothing moves vertically and the error is invisible; on a staircase the
 * body climbs up to 0.32 m per step, so the shot leaves from a third of a metre below where the
 * player is looking and buries itself in the tread ahead of them.
 *
 * ## Why this is its own module and not part of `game.ts`
 *
 * It lived in `game.ts` first, and `Play` imported it from there — but `game.ts` imports `Play`,
 * so that closed a cycle. Vite resolves it and the web build never complained. The native bundler
 * does not: the packaged Android build evaluated to a runtime that logged nothing at all, not even
 * the scene's own boot line, and presented zero frames while the engine's own proof app on the
 * same device presented every one of them. A leaf module both sides import has no cycle to break.
 */
const postPhysics: { run: (() => void) | undefined } = { run: undefined };

/** Register the callback, or pass `undefined` to clear it when a scene exits. */
export function onAfterPhysics(run: (() => void) | undefined): void {
  postPhysics.run = run;
}

/** Registered in `defineGame` immediately after `rapier()`, so the world has already stepped. */
export const postPhysicsPlugin = {
  update() {
    postPhysics.run?.();
  },
};

/**
 * The one-way channel from the HUD to the running scene.
 *
 * `src/game.ts` owns the UI intent listener, and the scene owns the simulation, so an order the
 * player pressed in the React layer needs one line between them. This is that line: the scene
 * installs a handler in `enter()` and the game forwards to it. Nothing comes back this way — the
 * HUD reads the published state instead, which is what keeps one source of truth on the side that
 * owns the rules.
 */
export type ISceneIntent = (intent: string, payload?: unknown) => void;

let dispatch: ISceneIntent | undefined;

/** Installed by the scene on `enter()`. */
export function onSceneIntent(handler: ISceneIntent): void {
  dispatch = handler;
}

/** Forwards a UI intent to the running scene, or drops it when no scene is listening. */
export function sendSceneIntent(intent: string, payload?: unknown): void {
  dispatch?.(intent, payload);
}

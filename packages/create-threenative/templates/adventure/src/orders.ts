/**
 * The one-way channel from the HUD to the running scene.
 *
 * `src/game.ts` owns the UI intent listener, and the scene owns the rules, so a button the player
 * pressed in the React layer (continue the dialogue, stay a little longer, start again) needs one
 * line between them. This is that line: the scene installs a handler in `enter()` and the game
 * forwards to it. Nothing comes back this way — the HUD reads the published state instead.
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

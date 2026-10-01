/**
 * What the UI asked for, waiting for the scene to read it.
 *
 * `game.ui.onIntent` fires outside any scene, so the listener only *files* the request here and the
 * scene drains it once a frame, inside the fixed step, where changing game state is safe. The queue
 * is the seam: nothing in the HUD can reach the simulation any other way.
 */
export interface IIntent {
  readonly intent: string;
  readonly payload?: unknown;
}

const pending: IIntent[] = [];

export function pushIntent(intent: string, payload?: unknown): void {
  pending.push({ intent, payload });
}

export function drainIntents(): IIntent[] {
  return pending.splice(0);
}

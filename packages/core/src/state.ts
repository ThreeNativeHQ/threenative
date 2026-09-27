import { type StoreApi, createStore } from "zustand/vanilla";

export type StatePatch<T extends Record<string, unknown>> = Partial<T> | ((state: T) => Partial<T>);

export type GameStore<T extends Record<string, unknown>> = StoreApi<T> & {
  getPublishedState(): T;
  set(patch: StatePatch<T>): void;
  flush(): void;
  start(): void;
  stop(): void;
};

/**
 * A store the UI reads, coalesced to one publication per frame unless a game names an interval.
 *
 * `intervalMs` is an override, not the rule. A fixed 100 ms default published the HUD ten times a
 * second whatever the frame rate was, which reads as a HUD that is not live — the number a player
 * watches moves in visible steps while the scene beside it runs smoothly. Left unset, `flush` is
 * called once per frame by the loop that draws that frame, so a HUD updates at the rate the game
 * actually runs at, and a slower interval is available to a game that measured a reason for one.
 */
export function createGameStore<T extends Record<string, unknown>>(
  initial: T,
  intervalMs?: number,
): GameStore<T> {
  const store = createStore<T>(() => ({ ...initial }));
  const getPublishedState = store.getState;
  const current = { ...initial };
  const pending: Partial<T> = {};
  let hasPending = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  store.subscribe((state) => {
    for (const key in current) {
      if (!(key in state)) Reflect.deleteProperty(current, key);
    }
    Object.assign(current, state);
  });
  const flush = () => {
    if (!hasPending) return;
    hasPending = false;
    const patch = { ...pending };
    for (const key in pending) Reflect.deleteProperty(pending, key);
    store.setState(patch);
  };
  const gameStore = store as GameStore<T>;
  gameStore.getPublishedState = getPublishedState;
  gameStore.getState = () => current;
  gameStore.set = (patch: StatePatch<T>) => {
    const next = typeof patch === "function" ? patch(current) : patch;
    Object.assign(pending, next);
    Object.assign(current, next);
    hasPending = true;
  };
  gameStore.flush = flush;
  gameStore.start = () => {
    // No interval means the frame drives the flush; only a game that named one gets a timer.
    if (intervalMs === undefined || timer !== undefined) return;
    timer = setInterval(flush, intervalMs);
  };
  gameStore.stop = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    flush();
  };
  return gameStore;
}

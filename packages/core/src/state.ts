import { type StoreApi, createStore } from "zustand/vanilla";

export type StatePatch<T extends Record<string, unknown>> = Partial<T> | ((state: T) => Partial<T>);

export type GameStore<T extends Record<string, unknown>> = StoreApi<T> & {
  set(patch: StatePatch<T>): void;
  flush(): void;
  start(): void;
  stop(): void;
};

export function createGameStore<T extends Record<string, unknown>>(
  initial: T,
  intervalMs = 100,
): GameStore<T> {
  const store = createStore<T>(() => ({ ...initial }));
  let pending: Partial<T> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  const flush = () => {
    if (pending === undefined) return;
    const patch = pending;
    pending = undefined;
    store.setState(patch);
  };

  const gameStore = store as GameStore<T>;
  gameStore.set = (patch: StatePatch<T>) => {
    const next = typeof patch === "function" ? patch(store.getState()) : patch;
    pending = { ...pending, ...next };
  };
  gameStore.flush = flush;
  gameStore.start = () => {
    if (timer !== undefined) return;
    timer = setInterval(flush, intervalMs);
  };
  gameStore.stop = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    flush();
  };
  return gameStore;
}

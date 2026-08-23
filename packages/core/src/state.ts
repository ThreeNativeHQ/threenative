import { type StoreApi, createStore } from "zustand/vanilla";

export type StatePatch<T extends Record<string, unknown>> = Partial<T> | ((state: T) => Partial<T>);

export type GameStore<T extends Record<string, unknown>> = StoreApi<T> & {
  getPublishedState(): T;
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

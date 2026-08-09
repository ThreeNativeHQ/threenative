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
  const current = { value: store.getState() };
  let pending: Partial<T> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  store.subscribe((state) => Object.assign(current, { value: state }));
  const flush = () => {
    if (pending === undefined) return;
    const patch = pending;
    pending = undefined;
    store.setState(patch);
  };
  const gameStore = store as GameStore<T>;
  gameStore.getState = () => current.value;
  gameStore.set = (patch: StatePatch<T>) => {
    const next = typeof patch === "function" ? patch(current.value) : patch;
    pending = { ...pending, ...next };
    current.value = { ...current.value, ...next };
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

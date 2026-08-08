import { afterEach, describe, expect, it, vi } from "vitest";
import { type Game, defineGame } from "../src/game.js";
import { acceptHotUpdate } from "../src/hot.js";
import { Scene } from "../src/scene.js";

type State = Record<string, unknown>;
type DisposeCallback = (data: Record<string, unknown>) => void;

function hotContext() {
  let disposeCallback: DisposeCallback | undefined;
  return {
    data: {} as Record<string, unknown>,
    accepted: 0,
    invalidated: [] as string[],
    accept() {
      this.accepted += 1;
    },
    dispose(callback: DisposeCallback) {
      disposeCallback = callback;
    },
    invalidate(message?: string) {
      this.invalidated.push(message ?? "");
    },
    triggerDispose() {
      if (disposeCallback === undefined)
        throw new Error("HMR dispose callback was not registered.");
      disposeCallback(this.data);
    },
  };
}

function game<TState extends State>(initialState: TState) {
  class TestScene extends Scene<TState> {}
  return defineGame<TState>({ initialState, scenes: { test: TestScene }, start: "test" });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("acceptHotUpdate", () => {
  it("should do nothing when import.meta.hot is undefined", () => {
    const hot = hotContext();
    const current = game({ score: 0 });
    const stop = vi.spyOn(current, "stop");

    acceptHotUpdate(current, undefined);

    expect(hot.accepted).toBe(0);
    expect(hot.invalidated).toEqual([]);
    expect(stop).not.toHaveBeenCalled();
  });

  it("should reinstate the carried store into the rebuilt game", () => {
    const hot = hotContext();
    const current = game({ score: 0 });
    acceptHotUpdate(current, hot);
    current.state.set({ score: 7 });
    hot.triggerDispose();

    const rebuilt = game({ score: 0 });
    acceptHotUpdate(rebuilt, hot);

    expect(rebuilt.state.getState().score).toBe(7);
    expect(hot.accepted).toBe(2);
  });

  it("should drop keys the new state no longer declares", () => {
    const hot = hotContext();
    const current = game({ a: 1, b: 2 });
    acceptHotUpdate(current, hot);
    hot.triggerDispose();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const rebuilt = game({ a: 0 });
    acceptHotUpdate(rebuilt, hot);

    expect(rebuilt.state.getState()).toEqual({ a: 1 });
    expect(info).toHaveBeenCalledWith(expect.stringContaining("b"));
  });

  it("should keep the declared default for a newly added key", () => {
    const hot = hotContext();
    const current = game({ a: 1 });
    acceptHotUpdate(current, hot);
    hot.triggerDispose();

    const rebuilt = game({ a: 0, c: 3 });
    acceptHotUpdate(rebuilt, hot);

    expect(rebuilt.state.getState()).toEqual({ a: 1, c: 3 });
  });

  it("should throw and invalidate when the store holds a class instance", () => {
    class Player {}
    const hot = hotContext();
    const current = game<{ player: unknown }>({ player: null });
    const stop = vi.spyOn(current, "stop");
    acceptHotUpdate(current, hot);
    current.state.set({ player: new Player() });

    expect(() => hot.triggerDispose()).toThrow(/state\.player/u);
    expect(hot.invalidated[0]).toContain("state.player");
    expect(hot.data.threenative).toBeUndefined();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("should stop the old game even when capture throws", () => {
    const hot = hotContext();
    const current = game<{ value: unknown }>({ value: undefined });
    const stop = vi.spyOn(current, "stop");
    acceptHotUpdate(current, hot);

    expect(() => hot.triggerDispose()).toThrow(/state\.value/u);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("should serialise overlapping reloads", () => {
    const hot = hotContext();
    const current = game({ score: 4 });
    const stop = vi.spyOn(current, "stop");
    acceptHotUpdate(current, hot);

    hot.triggerDispose();
    hot.triggerDispose();

    expect(stop).toHaveBeenCalledTimes(1);
    expect((hot.data.threenative as { reloads: number }).reloads).toBe(1);
  });

  it("should report null physics when no physics plugin is installed", () => {
    const host = {} as { __THREENATIVE__?: { hot?: () => { physics: number | null } } };
    vi.stubGlobal("window", host);
    const current = {
      ctx: {
        entities: { snapshot: () => ({}) },
        physics: undefined,
        scene: { traverse: () => undefined },
      },
      state: {},
      stop: () => undefined,
    } as unknown as Game<State, undefined>;

    acceptHotUpdate(current, hotContext());

    expect(host.__THREENATIVE__?.hot?.().physics).toBe(null);
  });

  it("should report physics body counts through the duck-typed probe", () => {
    const host = {} as { __THREENATIVE__?: { hot?: () => { physics: number | null } } };
    vi.stubGlobal("window", host);
    const current = {
      ctx: {
        entities: { snapshot: () => ({}) },
        physics: { numBodies: () => 3 },
        scene: { traverse: () => undefined },
      },
      state: {},
      stop: () => undefined,
    } as unknown as Game<State, { numBodies: () => number }>;

    acceptHotUpdate(current, hotContext());

    expect(host.__THREENATIVE__?.hot?.().physics).toBe(3);
  });
});

import { describe, expect, test } from "vitest";
import { GAME_STATE_MESSAGE, UI_INTENT_MESSAGE, connectUiBridge } from "../src/ui-bridge.js";
import { onUiIntent, publishUiState, sendUiIntent, subscribeUiState } from "../src/ui-state.js";

type Scope = Record<string, unknown>;

/** A store shaped like ThreeNative's: a live value and a throttled published one. */
function fakeStore(initial: Record<string, unknown>) {
  const listeners = new Set<() => void>();
  const live = { ...initial };
  let published = { ...initial };
  return {
    getState: () => live,
    getPublishedState: () => published,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Move the live value without publishing, the way a tick does. */
    tick(patch: Record<string, unknown>): void {
      Object.assign(live, patch);
    },
    /** Publish, the way the store's own 100 ms flush does. */
    flush(): void {
      published = { ...live };
      for (const listener of [...listeners]) listener();
    },
  };
}

const now = (flush: () => void): void => flush();

describe("published state", () => {
  test("should carry the throttled state, not the live one", () => {
    const scope: Scope = {};
    const game = connectUiBridge({ end: "game", scope });
    const ui = connectUiBridge({ end: "ui", scope });
    const mirror = subscribeUiState<{ score: number }>(ui);
    const store = fakeStore({ score: 0 });
    publishUiState(game, store, { schedule: now });
    expect(mirror.get()).toEqual({ score: 0 });

    // Ten ticks between two publications must not become ten frames on the bridge.
    for (let tick = 1; tick <= 10; tick += 1) store.tick({ score: tick });
    expect(mirror.get()).toEqual({ score: 0 });
    store.flush();
    expect(mirror.get()).toEqual({ score: 10 });
  });

  test("should publish nothing while no overlay is attached", () => {
    // A `renderer: "native"` game on a native host: the runtime installed `__tnUiPost`, and no
    // overlay ever came up. Serialising the whole store ten times a second for no reader is the
    // cost acceptance criterion 5 says such a game must not pay.
    const sent: string[] = [];
    const scope: Scope = {
      __tnUiPost: (frame: string) => sent.push(frame),
      __tnUiOverlayAttached: () => attached,
    };
    let attached = false;
    const game = connectUiBridge({ end: "game", scope });
    const store = fakeStore({ score: 0 });
    publishUiState(game, store, { schedule: now });
    expect(game.hasPeer()).toBe(false);
    for (let tick = 1; tick <= 5; tick += 1) {
      store.tick({ score: tick });
      store.flush();
    }
    expect(sent).toEqual([]);

    // The overlay comes up. The next publication is the first frame the UI ever sees.
    attached = true;
    store.tick({ score: 6 });
    store.flush();
    expect(sent).toEqual(['{"type":"tn:state","state":{"score":6}}']);
  });

  test("should not republish an unchanged snapshot", () => {
    const scope: Scope = {};
    const game = connectUiBridge({ end: "game", scope });
    const ui = connectUiBridge({ end: "ui", scope });
    const posted: unknown[] = [];
    ui.onMessage((message) => posted.push(message));
    const store = fakeStore({ score: 0 });
    publishUiState(game, store, { schedule: now });
    expect(posted).toHaveLength(1);
    store.flush();
    store.flush();
    expect(posted).toHaveLength(1);
  });

  test("should fail closed on a frame with no state object", () => {
    const scope: Scope = {};
    const ui = connectUiBridge({ end: "ui", scope });
    const game = connectUiBridge({ end: "game", scope });
    subscribeUiState(ui);
    expect(() => game.post({ type: GAME_STATE_MESSAGE, state: "gone" })).toThrow(
      /TN_UI_STATE_FRAME_INVALID/u,
    );
  });

  test("should refuse the wrong end at both ends", () => {
    const scope: Scope = {};
    const ui = connectUiBridge({ end: "ui", scope });
    const game = connectUiBridge({ end: "game", scope });
    expect(() => publishUiState(ui, fakeStore({}))).toThrow(/TN_UI_STATE_WRONG_END/u);
    expect(() => subscribeUiState(game)).toThrow(/TN_UI_STATE_WRONG_END/u);
    expect(() => sendUiIntent(game, "restart")).toThrow(/TN_UI_INTENT_WRONG_END/u);
    expect(() => onUiIntent(ui, () => undefined)).toThrow(/TN_UI_INTENT_WRONG_END/u);
  });
});

describe("intents", () => {
  test("should carry a named action from the UI to the game", () => {
    const scope: Scope = {};
    const game = connectUiBridge({ end: "game", scope });
    const ui = connectUiBridge({ end: "ui", scope });
    const seen: Array<[string, unknown]> = [];
    onUiIntent(game, (intent, payload) => seen.push([intent, payload]));
    sendUiIntent(ui, "restart");
    sendUiIntent(ui, "setVolume", 0.5);
    expect(seen).toEqual([
      ["restart", undefined],
      ["setVolume", 0.5],
    ]);
  });

  test("should fail closed on an unnamed intent, sending and receiving", () => {
    const scope: Scope = {};
    const game = connectUiBridge({ end: "game", scope });
    const ui = connectUiBridge({ end: "ui", scope });
    onUiIntent(game, () => undefined);
    expect(() => sendUiIntent(ui, "")).toThrow(/TN_UI_INTENT_INVALID/u);
    expect(() => ui.post({ type: UI_INTENT_MESSAGE })).toThrow(/TN_UI_INTENT_INVALID/u);
  });
});

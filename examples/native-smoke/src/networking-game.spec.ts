import { describe, expect, it } from "vitest";
import {
  type INetworkSnapshot,
  type INetworkingState,
  type IObservedPositions,
  observeSnapshot,
} from "./networking-game.js";

function snapshot(
  id: string,
  tick: number,
  x: number,
  z: number,
  lastActionId = 0,
): INetworkSnapshot {
  return {
    player: { id, lastActionId, x, z },
    serverMonoMs: tick,
    tick,
  };
}

function createStore(): { state: INetworkingState; store: Parameters<typeof observeSnapshot>[0] } {
  const state: INetworkingState = {
    networkConnected: false,
    networkError: "",
    networkRetry: 0,
    networkSessionId: "",
    networkStatus: "connected",
  };
  return {
    state,
    store: {
      flush: () => undefined,
      getState: () => state,
      set: (patch: Partial<INetworkingState>) => Object.assign(state, patch),
    },
  };
}

describe("native-smoke networking snapshot publication", () => {
  it("keeps the local render position absent until the local snapshot arrives", () => {
    const { state, store } = createStore();
    const positions: IObservedPositions = {
      local: undefined,
      peerLastSeenAtMs: undefined,
      remote: undefined,
      remoteDistance: 0,
    };
    const config = { enabled: true, playerId: "local-player" };
    const lastSnapshotTick = new Map<string, number>();

    observeSnapshot(
      store,
      config,
      snapshot("remote-player", 1, 7, -3),
      lastSnapshotTick,
      positions,
    );

    expect(state.networkLocalX).toBeUndefined();
    expect(state.networkLocalZ).toBeUndefined();
    expect(state.networkLocalX !== undefined).toBe(false);
    expect(state.networkPeerObserved).toBe(true);

    observeSnapshot(
      store,
      config,
      snapshot("local-player", 2, 2, 4, 1),
      lastSnapshotTick,
      positions,
    );

    expect(state.networkLocalX).toBe(2);
    expect(state.networkLocalZ).toBe(4);
    expect(state.networkLocalX !== undefined).toBe(true);
  });
});

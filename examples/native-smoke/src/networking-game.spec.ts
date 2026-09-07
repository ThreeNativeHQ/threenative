import type { INetworkConnection } from "@threenative/core/net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type INetworkSnapshot,
  type INetworkingState,
  type IObservedPositions,
  createNetworkingGame,
  observeSnapshot,
} from "./networking-game.js";

const { connectMock } = vi.hoisted(() => ({ connectMock: vi.fn() }));

vi.mock("@threenative/core/net", () => ({ connect: connectMock }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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
    networkLocalObserved: false,
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
    expect(state.networkLocalObserved).toBe(false);
    expect(state.networkPeerObserved).toBe(true);
    expect(Object.values(state)).not.toContain(undefined);

    observeSnapshot(
      store,
      config,
      snapshot("local-player", 2, 2, 4, 1),
      lastSnapshotTick,
      positions,
    );

    expect(state.networkLocalX).toBe(2);
    expect(state.networkLocalZ).toBe(4);
    expect(state.networkLocalObserved).toBe(true);
  });

  it("clears the published local render position before a retry snapshot arrives", async () => {
    const { state, store } = createStore();
    const connection: INetworkConnection = {
      close: vi.fn(async () => undefined),
      getStats: vi.fn(() => ({ sessionId: "session-1" }) as never),
      poll: vi
        .fn()
        .mockReturnValueOnce({
          disconnected: false,
          messages: [
            {
              channel: 2,
              data: new TextEncoder().encode(
                JSON.stringify({
                  player: { id: "local-player", lastActionId: 1, x: 2, z: 4 },
                  serverMonoMs: 1,
                  tick: 1,
                }),
              ),
            },
          ],
          reason: null,
        })
        .mockReturnValue({ disconnected: false, messages: [], reason: null }),
      send: vi.fn(() => true),
    };
    connectMock.mockResolvedValue(connection);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (input === "networking-session.json") {
          return {
            json: async () => ({
              expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
              issuerAuthorization: "grant-token",
            }),
            ok: true,
            status: 200,
          };
        }
        return {
          json: async () => ({
            credential: "join-token",
            expiresAt: new Date(Date.now() + 60 * 1000).toISOString(),
          }),
          ok: true,
          status: 200,
        };
      }),
    );
    const game = createNetworkingGame<typeof state>({
      enabled: true,
      endpoint: "https://game.example.test/connect",
      issuerUrl: "https://issuer.example.test/token",
      playerId: "local-player",
    });

    try {
      game.enter(store);
      await vi.waitFor(() => expect(state.networkConnected).toBe(true));
      game.update(store);
      expect(state.networkLocalX).toBe(2);
      expect(state.networkLocalZ).toBe(4);

      game.retry();
      await vi.waitFor(() => {
        game.update(store);
        expect(state.networkRetry).toBe(1);
      });

      expect(state.networkLocalObserved).toBe(false);
    } finally {
      game.exit();
    }
  });
});

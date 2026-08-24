import {
  type IUiBridge,
  type IUiStateMirror,
  connectUiBridge,
  publishHitRegions,
  sendUiIntent,
  subscribeUiState,
} from "@threenative/core/ui-layer";
import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

/**
 * The root of a game's UI, on every target.
 *
 * A game writes `src/ui/` once. On the web target it renders into the page beside the canvas;
 * on a native target the same bundle renders in the platform's own browser-class renderer,
 * composited over the game surface. Both go through the same two channels — the game's
 * published state in, the player's intents out — so a HUD cannot accidentally work in one
 * place and not the other.
 *
 * This component owns three things a game should never write itself: connecting the bridge,
 * mirroring the published state, and publishing the interactive rectangles the native input
 * host needs in order to decide which surface a touch belongs to.
 */

interface IUiLayerValue {
  readonly bridge: IUiBridge;
  readonly mirror: IUiStateMirror<Record<string, unknown>>;
}

const UiLayerContext = createContext<IUiLayerValue | undefined>(undefined);

function useUiLayer(name: string): IUiLayerValue {
  const value = useContext(UiLayerContext);
  if (value === undefined) {
    throw new Error(`TN_UI_LAYER_MISSING: ${name} must be used inside <UiLayer>.`);
  }
  return value;
}

export function UiLayer({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<IUiLayerValue | undefined>(undefined);
  useEffect(() => {
    const bridge = connectUiBridge({ end: "ui" });
    const mirror = subscribeUiState<Record<string, unknown>>(bridge);
    setValue({ bridge, mirror });
    return () => {
      mirror.stop();
      bridge.close();
      setValue(undefined);
    };
  }, []);
  useEffect(() => {
    if (value === undefined) return;
    // Started after the first commit, so the first publication measures a UI that has rendered.
    // A registry started before the tree exists publishes an empty set, and an empty set means
    // every touch falls through to the game — a HUD whose buttons all look dead.
    const registry = publishHitRegions({ bridge: value.bridge });
    return () => registry.stop();
  }, [value]);
  if (value === undefined) return null;
  return <UiLayerContext.Provider value={value}>{children}</UiLayerContext.Provider>;
}

/**
 * Read a slice of the game's published state.
 *
 * The UI holds a mirror, never the game object: on every native target the game is in another
 * realm, and a HUD written against a live store would work on web and read nothing on a phone.
 * The mirror is fed at the store's published cadence, which is not the game loop.
 */
export function useUiState<TSelected>(
  selector: (state: Record<string, unknown>) => TSelected,
): TSelected | undefined {
  const { mirror } = useUiLayer("useUiState");
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  return useSyncExternalStore(
    (onChange) => mirror.subscribe(onChange),
    () => {
      const state = mirror.get();
      return state === undefined ? undefined : selectorRef.current(state);
    },
    () => undefined,
  );
}

/**
 * Send an intent to the game — `restart`, `pause`, whatever the game named.
 *
 * Intents are one-way and the game may ignore one; that is not an error. Anything the UI needs
 * back arrives as published state, which keeps a single source of truth on the side that owns
 * the simulation.
 */
export function useUiIntent(): (intent: string, payload?: unknown) => void {
  const { bridge } = useUiLayer("useUiIntent");
  return useMemo(
    () => (intent: string, payload?: unknown) => sendUiIntent(bridge, intent, payload),
    [bridge],
  );
}

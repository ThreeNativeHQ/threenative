import { UiLayer, useUiIntent, useUiState } from "@threenative/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { type GameState, VISIBILITY_INTENT } from "../state.js";
import { Hud, captureScene, toggleFullscreen } from "./Hud.js";
import { Menu } from "./Menu.js";
import { automationRequest } from "./automation.js";

const TOAST_MS = 3600;

/** Below this width the study asks for the cheap tier, exactly as the source study did. */
const NARROW_PX = 700;

export function GameUi() {
  return (
    <UiLayer>
      <RainInterface />
    </UiLayer>
  );
}

/**
 * The interface, and the three things that are behaviour rather than markup.
 *
 * `useUiState` and `useUiIntent` need the bridge `UiLayer` opened, so they live in this inner
 * component rather than in `GameUi` itself — a hook above the provider throws. Everything the page
 * does that is not a control lives here: the status toast, the keyboard, and the two one-time
 * defaults that have to be applied against a real snapshot rather than guessed at mount.
 */
function RainInterface() {
  const state = useUiState<GameState>();
  const send = useUiIntent();
  const [toast, setToast] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const say = useCallback((text: string) => {
    setToast(text);
    setToastVisible(true);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastVisible(false), TOAST_MS);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  /**
   * Photosensitivity mode. Turning it on also takes automatic lightning down, because a reader who
   * asked for no flashes must not get them from the sky on their own.
   */
  const setSafeMode = useCallback(
    (on: boolean) => {
      send("setSafe", on);
      if (on) send("setAutoLightning", false);
      say(on ? "LIGHTNING DISABLED · photosensitivity mode" : "Lightning flashes enabled");
    },
    [say, send],
  );

  const toggleAutoLightning = useCallback(() => {
    if (state?.safe === true) {
      say("Disable photosensitivity mode first to enable lightning.");
      return;
    }
    send("setAutoLightning", state?.autoLightning !== true);
  }, [say, send, state?.autoLightning, state?.safe]);

  /**
   * The keyboard, and only the keys the engine's input map does not already own. `W A S D`, `Q E`,
   * `Shift`, `R` and `L` are the game's input map, so sending an intent from here as well would
   * strike twice per press and reset the view twice.
   */
  useEffect(() => {
    if (state === undefined) return;
    const actions: Record<string, () => void> = {
      KeyF: () => void toggleFullscreen(say),
      KeyH: () => send(state.uiHidden ? "showUi" : "hideUi"),
      KeyP: () => {
        void captureScene(say).catch((why: Error) => say(`Scene image failed: ${why.message}`));
      },
      KeyX: () => setSafeMode(!state.safe),
      Space: () => {
        send(state.paused ? "resume" : "pause");
        say(state.paused ? "SIMULATION RESUMED" : "SIMULATION PAUSED");
      },
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Escape") {
        send("closeHelp");
        return;
      }
      // A focused slider, select or text field owns its own keys.
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (event.repeat) return;
      const run = actions[event.code];
      if (run === undefined) return;
      // Space scrolls the page and the shortcuts must not reach the browser's own bindings.
      event.preventDefault();
      run();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [say, send, setSafeMode, state]);

  /**
   * Tab visibility, held in the UI realm because `document` is a browser API: this is the only
   * place that knows whether the frame is still on screen, and a hidden tab stops the engine loop,
   * so nothing in a scene frame would ever notice. Separate from the pause intent on purpose — the
   * two clear independently, and a tab that comes back must not resume a paused storm.
   */
  useEffect(() => {
    const report = () => send(VISIBILITY_INTENT, document.hidden);
    document.addEventListener("visibilitychange", report);
    return () => document.removeEventListener("visibilitychange", report);
  }, [send]);

  /**
   * Reduced motion, read in the UI realm and applied once. A reader who then flips a switch has
   * said something newer than their operating system, so the preference is never re-applied over a
   * snapshot — which is also why it needs a ref rather than an effect dependency.
   */
  const reducedApplied = useRef(false);
  useEffect(() => {
    if (state === undefined || reducedApplied.current) return;
    reducedApplied.current = true;
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    send("setSafe", true);
    send("setAutoLightning", false);
    send("setCinematic", false);
  }, [send, state]);

  /** The first snapshot picks a tier from the width; a later choice is the player's and is kept. */
  const qualityChosen = useRef(false);
  useEffect(() => {
    if (state === undefined || qualityChosen.current) return;
    qualityChosen.current = true;
    // `?quality=` outranks the width default: an operator asking for `high` on a phone-sized
    // window is asking for the tier, not for the guess this would otherwise make.
    const asked = automationRequest(window.location.search).quality;
    if (asked !== undefined) {
      send("setQuality", asked);
      return;
    }
    send("setQuality", window.innerWidth < NARROW_PX ? "performance" : "high");
  }, [send, state]);

  // Nothing yet from the game, so nothing is claimed: the engine's own loading screen is still up.
  if (state === undefined) return null;

  return (
    <>
      <Hud
        panelOpen={panelOpen}
        say={say}
        send={send}
        setPanelOpen={setPanelOpen}
        state={state}
        toast={toast}
        toastVisible={toastVisible}
      />
      <Menu
        panelOpen={panelOpen}
        say={say}
        send={send}
        setPanelOpen={setPanelOpen}
        setSafeMode={setSafeMode}
        state={state}
        toggleAutoLightning={toggleAutoLightning}
      />
    </>
  );
}

import { defineGame, type IGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import { UI_READY_INTENT } from "@threenative/core/ui-layer";
import config from "../threenative.config.js";
import { STORM_AUDIO_ENTITY, type IStormAudio } from "./audio/storm.js";
import { Coast } from "./scenes/Boot.js";
import {
  VISIBILITY_INTENT,
  type GameState,
  type PresetName,
  type QualityName,
  type WeatherKey,
  intentPatch,
} from "./state.js";

const game = defineGame<GameState>({
  input: {
    altitude: { down: ["KeyQ"], up: ["KeyE"] },
    boost: { keys: ["ShiftLeft", "ShiftRight"] },
    move: {
      down: ["ArrowDown", "KeyS"],
      left: ["ArrowLeft", "KeyA"],
      right: ["ArrowRight", "KeyD"],
      up: ["ArrowUp", "KeyW"],
    },
    resetCamera: { keys: ["KeyR"] },
    strike: { keys: ["KeyL"] },
  },
  plugins: [playtest()],
  display: config.display,
  render: config.renderer,
  scenes: { coast: Coast },
  seed: 607,
  start: "coast",
});

export default game;

/**
 * The intents the UI sends, and the payload each one carries. The UI slice owns nothing else:
 * every control here is a named intent and a validated payload, and nothing else crosses.
 */
export type RainIntent =
  | { readonly name: "closeHelp" }
  | { readonly name: "help" }
  | { readonly name: "hideUi" }
  | { readonly name: "pause" }
  | { readonly name: "resetCamera"; readonly payload?: never }
  | { readonly name: "resume" }
  | { readonly name: "setAudioEnabled"; readonly payload: boolean }
  | { readonly name: "setAutoLightning"; readonly payload: boolean }
  | { readonly name: "setCinematic"; readonly payload: boolean }
  | { readonly name: "setDroplets"; readonly payload: boolean }
  | { readonly name: "setMuted"; readonly payload: boolean }
  | { readonly name: "setPreset"; readonly payload: PresetName }
  | { readonly name: "setQuality"; readonly payload: QualityName }
  | { readonly name: "setSafe"; readonly payload: boolean }
  | { readonly name: "setWeather"; readonly payload: Partial<Record<WeatherKey, number>> }
  | { readonly name: "showUi" }
  | { readonly name: "strike"; readonly payload?: never }
  | { readonly name: typeof VISIBILITY_INTENT; readonly payload: boolean };

game.ui.onIntent((intent, payload) => {
  // The framework's own "my tree has rendered" signal, and the one control that is not a player's:
  // it arrives on the same door but carries no weather, so it is answered before the validator
  // ever sees it. `uiReady` mirrors `game.ui.connected` rather than being set optimistically, so a
  // UI that never came up leaves the loading study up instead of hiding it over nothing.
  if (intent === UI_READY_INTENT) {
    game.state.set({ uiReady: game.ui.connected });
    game.state.flush();
    return;
  }
  // The two holds that cannot arrive inside a frame: the loop is stopped while paused and while the
  // tab is hidden, so nothing in `Boot.ts` runs to notice. They are answered here, before the
  // validator, because neither is a weather intent and neither needs a state field of its own.
  const storm = (): IStormAudio | undefined =>
    game.ctx?.entities.get<IStormAudio>(STORM_AUDIO_ENTITY);
  if (intent === "pause" || intent === "resume") storm()?.setSilenced(intent === "pause");
  if (intent === VISIBILITY_INTENT) {
    if (typeof payload !== "boolean") {
      console.warn(`TN_RAIN_INTENT ${intent}: expected a boolean payload`);
      return;
    }
    storm()?.setHidden(payload);
    return;
  }
  let patch: Partial<GameState>;
  try {
    patch = intentPatch(intent, payload, game.state.getState().target);
  } catch (why) {
    // Reported and dropped rather than thrown: one malformed control must not take the gesture
    // flow down with it, and the rejection is visible in the console where the next agent looks.
    console.warn(`TN_RAIN_INTENT ${intent}: ${(why as Error).message}`);
    return;
  }
  // The loop's own pause, so the renderer, the shaders and the clock all stop together. The
  // state patch above publishes the pause through the bridge either way.
  if (intent === "pause") game.pause();
  if (intent === "resume") game.resume();
  game.state.set(patch);
  // The frame loop flushes too, but a control must feel instant: a slider that waits for the next
  // frame reads as a dropped drag.
  game.state.flush();
});

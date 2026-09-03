import { defineGame, replay } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import type { IPhysicsContext } from "@threenative/physics";
import { rapier } from "@threenative/physics";
import config from "../threenative.config.js";
import { drainPlaytestEvents } from "./playtest-events.js";
import { Boot } from "./scenes/Boot.js";
import { Play } from "./scenes/Play.js";
import type { GameState } from "./state.js";

const game = defineGame<GameState, IPhysicsContext>({
  input: {
    // The four directions of `input.vector("move")`. Declared rather than inherited from the
    // default binding, so the axis every scene reads is visible where the game is defined.
    move: {
      down: ["ArrowDown", "KeyS"],
      left: ["ArrowLeft", "KeyA"],
      right: ["ArrowRight", "KeyD"],
      up: ["ArrowUp", "KeyW"],
    },
    // Down the sights. The right mouse button is the mouse binding every shooter uses; KeyQ is
    // here so a scenario — and a keyboard-only player — can hold it without a pointer.
    aim: { keys: ["KeyQ"], mouseButtons: [2] },
    blast: { keys: ["KeyE"], buttons: [2] },
    // Ctrl is the conventional crouch and is routinely eaten by the window manager, so KeyC is a
    // second binding rather than a replacement.
    crouch: { keys: ["ControlLeft", "ControlRight", "KeyC"] },
    damage: { keys: ["KeyH"] },
    fire: { buttons: [0], keys: ["KeyF", "Space"], mouseButtons: [0] },
    look: { pointerRelative: true },
    lethal: { keys: ["KeyX"] },
    probe: { keys: ["KeyV"] },
    projectile: { buttons: [1], keys: ["KeyG"] },
    reload: { buttons: [3], keys: ["KeyR"] },
    // Enter, not KeyR: R is the reload key in every shooter, and a player who taps it to top up
    // a magazine should not lose the round.
    restart: { keys: ["Enter", "NumpadEnter"] },
    sprint: { keys: ["ShiftLeft", "ShiftRight"] },
  },
  plugins: [rapier(), replay(), playtest({ events: drainPlaytestEvents })],
  display: config.display,
  render: config.renderer,
  scenes: { boot: Boot, play: Play },
  seed: 89089,
  start: "boot",
});

export default game;

/**
 * What the UI can ask the game to do.
 *
 * Intents are one-way and named by the game: the UI sends `restart`, `pause` or `resume` and the
 * game decides what each means. Nothing comes back this way — the UI reads the game's published
 * state instead, which keeps one source of truth on the side that owns the simulation.
 */
game.ui.onIntent((intent) => {
  if (intent === "restart") void game.goto("play");
  if (intent === "pause") game.pause();
  if (intent === "resume") game.resume();
  game.state.set({
    // `game.ui.connected` is true only once the UI announced itself, which is what tells an
    // overlay that never came up apart from a game whose HUD is simply empty.
    uiReady: game.ui.connected,
    ...(intent === "pause" || intent === "resume" ? { paused: intent === "pause" } : {}),
  });
  game.state.flush();
});

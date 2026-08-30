import { defineGame, replay } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import type { IPhysicsContext } from "@threenative/physics";
import { rapier } from "@threenative/physics";
import config from "../threenative.config.js";
import { MainMenu } from "./scenes/MainMenu.js";
import { Play } from "./scenes/Play.js";
import type { GameState } from "./state.js";

// game.state is the single store: the fixed-step loop writes it, and React/playtests read it.
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
    jump: { buttons: [0], keys: ["Space"] },
    flagGust: { keys: ["KeyG"] },
    restart: { keys: ["KeyR"] },
    // Wheel, pinch and the right stick share one portable camera intent. Negative DOM deltaY
    // (toward-user) is positive scroll intent on browser and native; the scene owns the framing.
    zoom: { gamepadAxes: [3], pinch: true, scroll: true },
  },
  plugins: [rapier(), replay(), playtest()],
  display: config.display,
  render: config.renderer,
  scenes: { menu: MainMenu, play: Play },
  seed: 90210,
  start: "menu",
});

export default game;

/**
 * What the UI can ask the game to do.
 *
 * Intents are one-way and named by the game: the UI sends `restart`, `pause` or `resume` and the
 * game decides what each means. Nothing comes back this way — the UI reads the game's published
 * state instead, which keeps one source of truth on the side that owns the simulation.
 */
game.ui.onIntent((intent, payload) => {
  if (intent === "start-game") {
    const name =
      typeof payload === "object" &&
      payload !== null &&
      typeof (payload as { name?: unknown }).name === "string"
        ? (payload as { name: string }).name.trim().slice(0, 24)
        : "";
    if (name.length === 0) return;
    void game.goto("play", { carry: { characterName: name } });
  }
  if (intent === "back-to-menu") void game.goto("menu");
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

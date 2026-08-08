import { defineGame } from "@threenative/core";
import { acceptHotUpdate } from "@threenative/core/hot";
import type { PhysicsContext } from "@threenative/physics";
import { rapier } from "@threenative/physics";
import { Play } from "./scenes/Play.js";
import type { GameState } from "./state.js";
import "./style.css";

const score = document.querySelector<HTMLSpanElement>("#score");
const app = document.querySelector<HTMLElement>("#app");
if (app === null) throw new Error("Missing #app element.");

const game = defineGame<GameState, PhysicsContext>({
  // Without a container the canvas is appended to <body> as the last child,
  // where it lands after #app in the layout and paints over everything else.
  container: app,
  plugins: [
    rapier(),
    (ctx) =>
      ctx.state.subscribe((state) => {
        if (score !== null) score.textContent = String(state.score);
      }),
  ],
  scenes: { play: Play },
  start: "play",
});

import.meta.hot?.accept();
acceptHotUpdate(game, import.meta.hot);
void game.start();

import { defineGame } from "@threenative/core";
import type { PhysicsContext } from "@threenative/physics";
import { rapier } from "@threenative/physics";
import { type GameState, Play } from "./scenes/Play.js";
import "./style.css";

const score = document.querySelector<HTMLSpanElement>("#score");
const app = document.querySelector<HTMLElement>("#app");
if (app === null) throw new Error("Missing #app element.");

const game = defineGame<GameState, PhysicsContext>({
  // Without a container the canvas is appended to <body> as the last child,
  // where it lands after #app in the layout and paints over everything else.
  container: app,
  initialState: { playerX: -2, score: 0 },
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

void game.start();

import { defineGame } from "@threenative/core";
import type { PhysicsContext } from "@threenative/physics";
import { rapier } from "@threenative/physics";
import { Play } from "./scenes/Play.js";
import type { GameState } from "./state.js";
import "./style.css";

const score = document.querySelector<HTMLSpanElement>("#score");
const total = document.querySelector<HTMLSpanElement>("#total");
const status = document.querySelector<HTMLParagraphElement>("#status");
const deaths = document.querySelector<HTMLSpanElement>("#deaths");
const progressFill = document.querySelector<HTMLSpanElement>("#progress-fill");
const app = document.querySelector<HTMLElement>("#app");
if (app === null) throw new Error("Missing #app element.");

const game = defineGame<GameState, PhysicsContext>({
  // Without a container the canvas is appended to <body> as the last child,
  // where it lands after #app in the layout and paints over everything else.
  container: app,
  initialState: {
    playerX: -9,
    score: 0,
    total: 12,
    status: "Collect the stars and reach the flag",
    deaths: 0,
  },
  input: {
    move: {
      left: ["ArrowLeft", "KeyA"],
      right: ["ArrowRight", "KeyD"],
      up: ["ArrowUp", "KeyW"],
      down: ["ArrowDown", "KeyS"],
    },
    jump: { up: ["Space", "KeyZ"] },
    restart: { down: ["KeyR"] },
  },
  plugins: [
    rapier(),
    (ctx) =>
      ctx.state.subscribe((state) => {
        if (score !== null) score.textContent = String(state.score);
        if (total !== null) total.textContent = String(state.total);
        if (status !== null) status.textContent = state.status;
        if (deaths !== null) deaths.textContent = String(state.deaths);
        if (progressFill !== null) progressFill.style.width = `${state.total > 0 ? (state.score / state.total) * 100 : 0}%`;
      }),
  ],
  scenes: { play: Play },
  start: "play",
});

void game.start();

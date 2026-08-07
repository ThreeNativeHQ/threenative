import { defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import type { PhysicsContext } from "@threenative/physics";
import { rapier } from "@threenative/physics";
import { Play } from "./scenes/Play.js";
import type { GameState } from "./state.js";
import "./style.css";

const coins = document.querySelector<HTMLSpanElement>("#coins");
const total = document.querySelector<HTMLSpanElement>("#total");
const status = document.querySelector<HTMLParagraphElement>("#status");
const deaths = document.querySelector<HTMLSpanElement>("#deaths");
const progressFill = document.querySelector<HTMLSpanElement>("#progress-fill");
const app = document.querySelector<HTMLElement>("#app");
if (app === null) throw new Error("Missing #app element.");

const game = defineGame<GameState, PhysicsContext>({
  container: app,
  initialState: {
    coins: 0,
    goalReached: false,
    respawns: 0,
    total: 12,
    status: "Collect the stars and reach the flag",
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
    playtest<GameState, PhysicsContext>(),
    (ctx) =>
      ctx.state.subscribe((state) => {
        if (coins !== null) coins.textContent = String(state.coins);
        if (total !== null) total.textContent = String(state.total);
        if (status !== null) status.textContent = state.goalReached ? `Trail complete! ${state.coins}/${state.total} stars • press R to replay` : state.status;
        if (deaths !== null) deaths.textContent = String(state.respawns);
        if (progressFill !== null) progressFill.style.width = `${state.total > 0 ? (state.coins / state.total) * 100 : 0}%`;
      }),
  ],
  scenes: { play: Play },
  start: "play",
});

void game.start();

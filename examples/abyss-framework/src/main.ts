import { defineGame } from "@threenative/core";
import "./style.css";
import { Abyss, type AbyssState } from "./scenes/Abyss.js";

const score = document.querySelector<HTMLSpanElement>("#score");
const playerX = document.querySelector<HTMLSpanElement>("#player-x");
const status = document.querySelector<HTMLSpanElement>("#status");
const time = document.querySelector<HTMLSpanElement>("#time");
const energy = document.querySelector<HTMLSpanElement>("#energy");
const hull = document.querySelector<HTMLSpanElement>("#hull");

const game = defineGame<AbyssState>({
  initialState: { elapsed: 0, energy: 100, hull: 100, playerX: 0, score: 0, status: "attract" },
  input: { pulse: { down: ["Space"], pointer: true } },
  plugins: [
    (ctx) => {
      const unsubscribe = ctx.state.subscribe((state) => {
        if (score !== null) score.textContent = String(state.score);
        if (playerX !== null) playerX.textContent = state.playerX.toFixed(2);
        if (status !== null) status.textContent = state.status;
        if (time !== null) time.textContent = state.elapsed.toFixed(1);
        if (energy !== null) energy.textContent = String(Math.round(state.energy));
        if (hull !== null) hull.textContent = String(Math.max(0, Math.round(state.hull)));
      });
      return unsubscribe;
    },
  ],
  renderer: { preferWebGPU: true },
  scenes: { play: Abyss },
  start: "play",
});

void game.start();

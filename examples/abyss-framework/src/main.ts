import { defineGame } from "@threenative/core";
import type { PhysicsContext } from "@threenative/physics";
import { rapier } from "@threenative/physics";
import "./style.css";
import { type GameState, Play } from "./scenes/Play.js";

const score = document.querySelector<HTMLSpanElement>("#score");
const playerX = document.querySelector<HTMLSpanElement>("#player-x");

const game = defineGame<GameState, PhysicsContext>({
  initialState: { playerX: -2, score: 0 },
  plugins: [
    rapier(),
    (ctx) => {
      const unsubscribe = ctx.state.subscribe((state) => {
        if (score !== null) score.textContent = String(state.score);
        if (playerX !== null) playerX.textContent = state.playerX.toFixed(2);
      });
      return unsubscribe;
    },
  ],
  renderer: { preferWebGPU: true },
  scenes: { play: Play },
  start: "play",
});

void game.start();

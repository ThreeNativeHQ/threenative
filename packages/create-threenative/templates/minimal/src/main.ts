import { defineGame } from "@threenative/core";
import type { PhysicsContext } from "@threenative/physics";
import { rapier } from "@threenative/physics";
import { type GameState, Play } from "./scenes/Play.js";
import "./style.css";

const score = document.querySelector<HTMLSpanElement>("#score");
const game = defineGame<GameState, PhysicsContext>({
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

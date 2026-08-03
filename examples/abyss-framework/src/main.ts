import { defineGame } from "@threenative/core";
import "./style.css";
import { Play } from "./scenes/Play.js";

const score = document.querySelector<HTMLSpanElement>("#score");

const game = defineGame({
  initialState: { score: 0 },
  plugins: [
    (ctx) => {
      const unsubscribe = ctx.state.subscribe((state) => {
        if (score !== null) score.textContent = String(state.score);
      });
      return unsubscribe;
    },
  ],
  renderer: { preferWebGPU: true },
  scenes: { play: Play },
  start: "play",
});

void game.start();

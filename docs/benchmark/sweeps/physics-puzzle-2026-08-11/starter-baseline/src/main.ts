import { acceptHotUpdate } from "@threenative/core/hot";
import game from "./game.js";
import "./style.css";

const score = document.querySelector<HTMLSpanElement>("#score");
const app = document.querySelector<HTMLElement>("#app");
if (app === null) throw new Error("Missing #app element.");

game.state.subscribe((state) => {
  if (score !== null) score.textContent = String(state.score);
});

import.meta.hot?.accept();
acceptHotUpdate(game, import.meta.hot);
void game.start().then(() => {
  const canvas = game.ctx?.renderer.domElement;
  if (canvas !== undefined) app.prepend(canvas);
});

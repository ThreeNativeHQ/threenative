import { acceptHotUpdate } from "@threenative/core/hot";
import game from "./game.js";
import "./style.css";

const app = document.querySelector<HTMLElement>("#app");
if (app === null) throw new Error("Missing #app element.");

// No DOM readout here. This template's HUD is `src/render/hud.ts`, drawn in the scene so it
// survives on native, and a second DOM copy of the same score rendered on top of it: a blind score
// of the first frame read "a small Score: 0 chip overlapping a large glowing SCORE 0". One HUD.

import.meta.hot?.accept();
acceptHotUpdate(game, import.meta.hot);
void game.start().then(() => {
  const canvas = game.ctx?.renderer.domElement;
  if (canvas !== undefined) app.prepend(canvas);
  const launch = document.querySelector<HTMLElement>("[data-threenative-launch]");
  const waitForCanvas = () => {
    if (document.querySelector("canvas") === null) {
      requestAnimationFrame(waitForCanvas);
      return;
    }
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (launch !== null) launch.remove();
      }),
    );
  };
  requestAnimationFrame(waitForCanvas);
});

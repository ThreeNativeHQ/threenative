import "./style.css";
import game from "./loading-leak-game.js";

const root = document.getElementById("root");
if (root === null) throw new Error("Missing #root element.");

void game.start().then(() => {
  const canvas = game.ctx?.renderer.domElement;
  if (canvas !== undefined) root.prepend(canvas);
});

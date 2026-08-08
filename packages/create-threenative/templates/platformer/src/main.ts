import { defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import type { PhysicsContext } from "@threenative/physics";
import { rapier } from "@threenative/physics";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { Boot } from "./scenes/Boot.js";
import { Level } from "./scenes/Level.js";
import type { GameState } from "./state.js";
import { App } from "./ui/App.js";
import "./style.css";

let collectedCoins = 0;
// biome-ignore lint/style/useConst: the callback closes over the game initialized below.
let game: ReturnType<typeof defineGame<GameState, PhysicsContext>>;
const events = () => {
  game.state.flush();
  const coins = game.state.getState().coins;
  const collected = Math.max(0, coins - collectedCoins);
  collectedCoins = coins;
  return Array.from({ length: collected }, () => ({ entity: "player", name: "collected" }));
};

game = defineGame<GameState, PhysicsContext>({
  input: {
    dash: { buttons: [7], down: ["ShiftLeft", "ShiftRight"] },
    jump: { buttons: [0], down: ["Space"] },
  },
  plugins: [rapier({ gravity: { x: 0, y: -26, z: 0 } }), playtest({ events })],
  scenes: { boot: Boot, level: Level },
  start: "boot",
});

const root = document.getElementById("root");
if (root === null) throw new Error("Missing #root element.");
createRoot(root).render(createElement(App, { game }));

import { defineGame } from "@threenative/core";
import { acceptHotUpdate } from "@threenative/core/hot";
import { playtest } from "@threenative/core/playtest";
import type { PhysicsContext } from "@threenative/physics";
import { rapier } from "@threenative/physics";
import { recast } from "@threenative/physics/navigation";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { drainPlaytestEvents as events } from "./playtest-events.js";
import { Boot } from "./scenes/Boot.js";
import { Level } from "./scenes/Level.js";
import type { GameState } from "./state.js";
import { App } from "./ui/App.js";
import "./style.css";
const game = defineGame<GameState, PhysicsContext>({
  input: {
    dash: { buttons: [7], down: ["ShiftLeft", "ShiftRight"] },
    jump: { buttons: [0], down: ["Space"] },
  },
  plugins: [rapier({ gravity: { x: 0, y: -26, z: 0 } }), recast(), playtest({ events })],
  scenes: { boot: Boot, level: Level },
  start: "boot",
});
import.meta.hot?.accept();
acceptHotUpdate(game, import.meta.hot);
const root = document.getElementById("root");
if (root === null) throw new Error("Missing #root element.");
const appRoot = root as typeof root & { __threenativeRoot?: ReturnType<typeof createRoot> };
const reactRoot = appRoot.__threenativeRoot ?? createRoot(appRoot);
appRoot.__threenativeRoot = reactRoot;
reactRoot.render(createElement(App, { game }));

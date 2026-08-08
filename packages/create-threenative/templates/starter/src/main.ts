import { defineGame } from "@threenative/core";
import { acceptHotUpdate } from "@threenative/core/hot";
import { playtest } from "@threenative/core/playtest";
import type { PhysicsContext } from "@threenative/physics";
import { rapier } from "@threenative/physics";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { Boot } from "./scenes/Boot.js";
import { Play } from "./scenes/Play.js";
import type { GameState } from "./state.js";
import { App } from "./ui/App.js";
import "./style.css";

const game = defineGame<GameState, PhysicsContext>({
  input: {
    jump: { buttons: [0], down: ["Space"] },
    restart: { down: ["KeyR"] },
  },
  plugins: [rapier(), playtest()],
  scenes: { boot: Boot, play: Play },
  seed: 90210,
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

import { defineGame } from "@threenative/core";
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
    inspect: { buttons: [1], down: ["KeyE", "e", "E", "Enter"] },
  },
  plugins: [rapier(), playtest()],
  scenes: { boot: Boot, play: Play },
  seed: 90210,
  start: "boot",
});

const root = document.getElementById("root");
if (root === null) throw new Error("Missing #root element.");
createRoot(root).render(createElement(App, { game }));

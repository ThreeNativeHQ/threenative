import { defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { Boot } from "./scenes/Boot.js";
import { Play } from "./scenes/Play.js";
import type { GameState } from "./state.js";
import { App } from "./ui/App.js";
import "./style.css";

const game = defineGame<GameState>({
  camera: { projection: "perspective", fov: 52, near: 0.1, far: 150 },
  render: { preferWebGPU: false },
  input: {
    jump: { buttons: [0], down: ["Space", "ArrowUp", "KeyW"] },
    laneLeft: { left: ["ArrowLeft", "KeyA"], down: ["ArrowLeft", "KeyA"] },
    laneRight: { right: ["ArrowRight", "KeyD"], down: ["ArrowRight", "KeyD"] },
    restart: { down: ["Enter", "KeyR"] },
    slide: { down: ["ArrowDown", "KeyS"] },
  },
  plugins: [playtest()],
  scenes: { boot: Boot, play: Play },
  seed: 90210,
  start: "boot",
});

const root = document.getElementById("root");
if (root === null) throw new Error("Missing #root element.");
createRoot(root).render(createElement(App, { game }));

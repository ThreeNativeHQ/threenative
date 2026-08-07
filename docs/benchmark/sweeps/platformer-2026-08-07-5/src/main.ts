import { defineGame, type GamePlugin } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import { type PhysicsContext, rapier } from "@threenative/physics";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { Play } from "./scenes/Play.js";
import { initialState, type GameState } from "./state.js";
import { App } from "./ui/App.js";
import "./style.css";

export const game = defineGame<GameState, PhysicsContext>({
  initialState,
  input: {
    move: { up: ["KeyW", "ArrowUp"], down: ["KeyS", "ArrowDown"], left: ["KeyA", "ArrowLeft"], right: ["KeyD", "ArrowRight"] },
    jump: { down: ["Space"] },
    pause: { down: ["KeyP", "Escape"] },
    restart: { down: ["KeyR"] },
  },
  plugins: [
    rapier({ gravity: { x: 0, y: -24, z: 0 } }) as GamePlugin<GameState, PhysicsContext>,
    playtest<GameState, PhysicsContext>(),
  ],
  render: { preferWebGPU: true },
  scenes: { play: Play },
  start: "play",
});

const root = document.querySelector<HTMLDivElement>("#root");
if (!root) throw new Error("Missing #root mount point");
createRoot(root).render(createElement(App, { game }));

import { defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import { type PhysicsContext, rapier } from "@threenative/physics";
import "./style.css";
import { createRoot } from "react-dom/client";
import { Level } from "./scenes/Level.js";
import { type GameState, initialState } from "./state.js";
import { App } from "./ui/App.js";

const game = defineGame<GameState, PhysicsContext>({
  initialState,
  input: {
    dash: { buttons: [7], down: ["ShiftLeft", "ShiftRight"] },
    jump: { buttons: [0], down: ["Space", "KeyK"] },
    move: {
      down: ["KeyS", "ArrowDown"],
      left: ["KeyA", "ArrowLeft"],
      right: ["KeyD", "ArrowRight"],
      up: ["KeyW", "ArrowUp"],
    },
    restart: { down: ["Enter"] },
  },
  plugins: [rapier(), playtest()],
  // WebGPU by default. `?webgl` forces the fallback path, which is how this
  // example is played back on machines whose headless WebGPU driver dies.
  renderer: { preferWebGPU: !new URLSearchParams(globalThis.location.search).has("webgl") },
  scenes: { level: Level },
  start: "level",
});

const root = document.getElementById("root");
if (root === null) throw new Error("Missing #root element.");
createRoot(root).render(<App game={game} />);

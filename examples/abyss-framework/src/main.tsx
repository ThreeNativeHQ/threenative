import { defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import "./style.css";
import { createRoot } from "react-dom/client";
import { Abyss, type AbyssState } from "./scenes/Abyss.js";
import { ViewportProbe } from "./scenes/ViewportProbe.js";
import { App } from "./ui/App.js";

const viewportProbe = new URLSearchParams(globalThis.location.search).has("viewport");

const game = defineGame<AbyssState>({
  initialState: {
    best: 0,
    elapsed: 0,
    energy: 100,
    fps: 0,
    hull: 100,
    hunters: 0,
    playerX: 0,
    pulsing: false,
    score: 0,
    status: "attract",
  },
  input: {
    move: {
      down: ["KeyS", "ArrowDown"],
      left: ["KeyA", "ArrowLeft"],
      right: ["KeyD", "ArrowRight"],
      up: ["KeyW", "ArrowUp"],
    },
    pulse: { down: ["Space"], pointer: true },
    start: { down: ["Enter"] },
  },
  plugins: [playtest()],
  renderer: { preferWebGPU: !viewportProbe },
  scenes: { play: viewportProbe ? ViewportProbe : Abyss },
  start: "play",
});

const root = document.getElementById("root");
if (root === null) throw new Error("Missing #root element.");
createRoot(root).render(<App game={game} />);

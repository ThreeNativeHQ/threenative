import { defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import "./style.css";
import { createRoot } from "react-dom/client";
import { Abyss, type AbyssState } from "./scenes/Abyss.js";
import { ViewportProbe } from "./scenes/ViewportProbe.js";
import { App } from "./ui/App.js";

const viewportProbe = new URLSearchParams(globalThis.location.search).has("viewport");

const game = defineGame<AbyssState>({
  camera: { far: 7_000, near: 5_000, projection: "orthogonal", size: 520 },
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

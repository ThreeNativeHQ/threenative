import { defineGame } from "@threenative/core";
import "./style.css";
import { createRoot } from "react-dom/client";
import { Abyss, type AbyssState } from "./scenes/Abyss.js";
import { App } from "./ui/App.js";

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
  input: { pulse: { down: ["Space"], pointer: true } },
  renderer: { preferWebGPU: true },
  scenes: { play: Abyss },
  start: "play",
});

const root = document.getElementById("root");
if (root === null) throw new Error("Missing #root element.");
createRoot(root).render(<App game={game} />);

import { defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import { type PhysicsContext, rapier } from "@threenative/physics";
import "./style.css";
import { createRoot } from "react-dom/client";
import { TerrainProbe, type TerrainState } from "./scenes/TerrainProbe.js";
import { TerrainApp } from "./ui/TerrainApp.js";

const game = defineGame<TerrainState, PhysicsContext>({
  assets: {
    basePath: "/terrain-assets",
    model: async () => ({}),
  },
  camera: { far: 1_000, near: 1, projection: "orthogonal", size: 150 },
  inputTarget: window,
  input: {
    move: {
      down: ["ArrowDown"],
      left: ["ArrowLeft"],
      right: ["ArrowRight"],
      up: ["ArrowUp"],
    },
  },
  initialState: { chunks: 0, playerX: 0 },
  plugins: [rapier(), playtest<TerrainState, PhysicsContext>()],
  renderer: { preferWebGPU: true },
  scenes: { terrain: TerrainProbe },
  seed: 20260808,
  start: "terrain",
});

const root = document.getElementById("root");
if (root === null) throw new Error("Missing #root element.");
const appRoot = root as typeof root & { __threenativeRoot?: ReturnType<typeof createRoot> };
const reactRoot = appRoot.__threenativeRoot ?? createRoot(appRoot);
appRoot.__threenativeRoot = reactRoot;
reactRoot.render(<TerrainApp game={game} />);

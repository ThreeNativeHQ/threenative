import { defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import { type IPhysicsContext, rapier } from "@threenative/physics";
import { recast } from "@threenative/physics/navigation";
import { DebugOverlay, GameCanvas } from "@threenative/ui";
import "./style.css";
import { createRoot } from "react-dom/client";
import { type INavigationState, NavigationProbe } from "./scenes/NavigationProbe.js";

const game = defineGame<INavigationState, IPhysicsContext>({
  camera: { far: 100, near: 0.1, projection: "orthogonal", size: 24 },
  inputTarget: window,
  plugins: [rapier({ gravity: { x: 0, y: 0, z: 0 } }), recast(), playtest()],
  renderer: { preferWebGPU: true },
  scenes: { navigation: NavigationProbe },
  start: "navigation",
});

const root = document.getElementById("root");
if (root === null) throw new Error("Missing #root element.");
createRoot(root).render(
  <main className="relative h-screen w-screen overflow-hidden bg-black">
    <GameCanvas className="absolute inset-0" game={game} />
    <DebugOverlay />
  </main>,
);

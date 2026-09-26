import { defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import { WorldProbe, type WorldState } from "./scenes/WorldProbe.js";

// Native entry for the `?world` fly-through (PRD-448 phase 4b). The desktop bundle carries the
// world-v1 fixture staged as an asset, so the scene streams the host-loadable `/world.json`
// rather than the web-only Vite `?url` next to `src/world-main.ts`.
WorldProbe.manifestUrl = "/world.json";

const game = defineGame<WorldState>({
  camera: { far: 1_000, fov: 60, near: 0.1, projection: "perspective" },
  input: { fly: { keys: ["KeyF"] } },
  initialState: {
    evictions: 0,
    failures: 0,
    instances: 0,
    loadsInFlight: 0,
    maxResidentCells: 0,
    residenceChanges: 0,
    residentCells: 0,
  },
  plugins: [playtest<WorldState>()],
  renderer: { preferWebGPU: true },
  scenes: { world: WorldProbe },
  seed: 20260925,
  start: "world",
});

export default game;

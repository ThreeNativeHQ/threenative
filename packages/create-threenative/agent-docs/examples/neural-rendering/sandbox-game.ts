import { defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import config from "../threenative.config.js";
import { type NeuralSandboxState, NeuralSnapshotScene } from "./scenes/NeuralSnapshotScene.js";

export default defineGame<NeuralSandboxState>({
  plugins: [playtest()],
  input: { capture: { keys: ["KeyC"] } },
  display: config.display,
  render: config.renderer,
  scenes: { neural: NeuralSnapshotScene },
  start: "neural",
});

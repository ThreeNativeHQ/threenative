import { createReplayDriver, defineGame, replay } from "@threenative/core";
import type { GamePluginHooks, GamePluginRuntime } from "@threenative/core";
import { acceptHotUpdate } from "@threenative/core/hot";
import { playtest } from "@threenative/core/playtest";
import "./style.css";
import { createRoot } from "react-dom/client";
import { Abyss, type AbyssState } from "./scenes/Abyss.js";
import { ViewportProbe } from "./scenes/ViewportProbe.js";
import { App } from "./ui/App.js";

const viewportProbe = new URLSearchParams(globalThis.location.search).has("viewport");
const replayPlugin = replay<AbyssState>();
let gameRuntime: GamePluginRuntime | undefined;
const replayRuntime: GamePluginHooks<AbyssState> = {
  setup: (_ctx, runtime) => {
    gameRuntime = runtime;
    return undefined;
  },
};

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
  plugins: [replayPlugin, replayRuntime, playtest()],
  renderer: { preferWebGPU: !viewportProbe },
  scenes: { play: viewportProbe ? ViewportProbe : Abyss },
  seed: 90210,
  start: "play",
});

if (import.meta.env.DEV) {
  Object.assign(globalThis, {
    __THREENATIVE_REPLAY__: {
      get recording() {
        return replayPlugin.recording;
      },
      export: () => JSON.stringify(replayPlugin.recording),
      replay: async () => {
        const recording = replayPlugin.recording;
        if (recording === undefined) throw new Error("No replay recording is available yet.");
        if (gameRuntime === undefined) throw new Error("The game runtime is not ready.");
        if (gameRuntime.random !== undefined) gameRuntime.random.state = recording.randomState;
        await game.goto("play");
        return createReplayDriver(recording, window)(gameRuntime);
      },
    },
  });
}

import.meta.hot?.accept();
acceptHotUpdate(game, import.meta.hot);
const root = document.getElementById("root");
if (root === null) throw new Error("Missing #root element.");
const appRoot = root as typeof root & { __threenativeRoot?: ReturnType<typeof createRoot> };
const reactRoot = appRoot.__threenativeRoot ?? createRoot(appRoot);
appRoot.__threenativeRoot = reactRoot;
reactRoot.render(<App game={game} />);

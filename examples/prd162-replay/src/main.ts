import { game, recordBrowserRun, recordingTicks, resetReplayState, runtimeReady } from "./game.js";

const app = document.querySelector<HTMLElement>("#app");
if (app === null) throw new Error("Missing #app element.");
Object.assign(globalThis, {
  __PRD162_REPLAY__: {
    recordBrowserRun,
    recordingTicks,
    runtimeReady,
    state: () => game.state.getState(),
  },
});
void game
  .start()
  .then(async () => {
    const canvas = game.ctx?.renderer.domElement;
    if (canvas !== undefined) app.append(canvas);
    const recording = await recordBrowserRun();
    resetReplayState();
    console.info(
      `[PRD162] browser-recording source=running-consumer ticks=${recording.ticks} input=${JSON.stringify(recording.input)}`,
    );
  })
  .catch((error: unknown) => {
    console.error(
      `TN_PRD162_BROWSER_START_FAILED:${error instanceof Error ? error.message : String(error)}`,
    );
  });

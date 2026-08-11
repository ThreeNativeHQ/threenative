import game, { type ISmokeStatus, status } from "./game.js";

declare global {
  var __THREENATIVE_NATIVE_SMOKE__: ISmokeStatus | undefined;
}
globalThis.__THREENATIVE_NATIVE_SMOKE__ = status;

void game.start().then(
  () => {
    status.ready = true;
    status.renderer = game.ctx?.renderer.kind;
    console.info(`TN_NATIVE_SMOKE_READY:${status.renderer ?? "unknown"}`);
  },
  (error: unknown) => {
    status.error = error instanceof Error ? error.message : String(error);
    console.error(`TN_NATIVE_SMOKE_FAILED:${status.error}`);
  },
);

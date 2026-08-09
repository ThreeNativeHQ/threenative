import { type Ctx, Scene, defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import { BoxGeometry, Mesh, MeshBasicMaterial } from "three";

interface SmokeState extends Record<string, unknown> {
  frames: number;
}

interface SmokeStatus {
  error?: string;
  frames: number;
  ready: boolean;
  renderer?: string;
}

declare global {
  var __THREENATIVE_NATIVE_SMOKE__: SmokeStatus | undefined;
  var canvas: HTMLCanvasElement | undefined;
}

const runtimeCanvas = globalThis.canvas;
if (runtimeCanvas === undefined)
  throw new Error("TN_NATIVE_CANVAS_MISSING: globalThis.canvas is required");

const status: SmokeStatus = { frames: 0, ready: false };
globalThis.__THREENATIVE_NATIVE_SMOKE__ = status;

class NativeSmoke extends Scene<SmokeState> {
  static override readonly initialState: SmokeState = { frames: 0 };

  override enter(ctx: Ctx<SmokeState>) {
    ctx.camera.position.z = 3;
    const cube = ctx.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial({ color: 0x44aaff })));
    ctx.entities.add("cube", cube);
    return (_ctx: Ctx<SmokeState>, dt: number) => {
      cube.rotation.x += dt * 0.5;
      cube.rotation.y += dt;
      status.frames += 1;
      if (status.frames === 1) console.info("TN_NATIVE_SMOKE_FIRST_FRAME");
      if (status.frames === 300) console.info("TN_NATIVE_SMOKE_300_FRAMES:300");
    };
  }
}

const game = defineGame<SmokeState>({
  canvas: runtimeCanvas,
  inputTarget: runtimeCanvas,
  plugins: [playtest()],
  scenes: { smoke: NativeSmoke },
  start: "smoke",
});

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

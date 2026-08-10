import { type Ctx, Scene, defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import { BoxGeometry, Mesh, MeshBasicMaterial } from "three";

interface SmokeState extends Record<string, unknown> {
  airborne: boolean;
  currentPointers: number;
  frames: number;
  leftGroundWithTwoPointers: boolean;
  maxPointers: number;
  movedWithTwoPointers: boolean;
}

export interface SmokeStatus {
  error?: string;
  frames: number;
  ready: boolean;
  renderer?: string;
}

declare global {
  var canvas: HTMLCanvasElement | undefined;
}
declare const __TN_PLAYTEST_ENABLED__: boolean;

export const status: SmokeStatus = { frames: 0, ready: false };

function requireRuntimeCanvas(): HTMLCanvasElement {
  const value = globalThis.canvas;
  if (value === undefined)
    throw new Error("TN_NATIVE_CANVAS_MISSING: globalThis.canvas is required");
  return value;
}

const runtimeCanvas = requireRuntimeCanvas();
runtimeCanvas.style.touchAction = "none";

class NativeSmoke extends Scene<SmokeState> {
  static override readonly initialState: SmokeState = {
    airborne: false,
    currentPointers: 0,
    frames: 0,
    leftGroundWithTwoPointers: false,
    maxPointers: 0,
    movedWithTwoPointers: false,
  };

  override enter(ctx: Ctx<SmokeState>) {
    ctx.camera.position.z = 3;
    const cube = ctx.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial({ color: 0x44aaff })));
    ctx.entities.add("cube", cube);
    const player = ctx.add(
      new Mesh(new BoxGeometry(0.4, 0.4, 0.4), new MeshBasicMaterial({ color: 0xffaa44 })),
    );
    player.position.set(-1, 0, 0);
    ctx.entities.add("multitouch-player", player);
    let maxPointers = 0;
    let movedWithTwoPointers = false;
    let leftGroundWithTwoPointers = false;
    let verticalVelocity = 0;
    return (frameCtx: Ctx<SmokeState>, dt: number) => {
      cube.rotation.x += dt * 0.5;
      cube.rotation.y += dt;
      const pointers = [...frameCtx.input.raw.pointers.values()];
      const moving = pointers.some(({ position }) => position.x < runtimeCanvas.width / 2);
      const jumping = pointers.some(({ position }) => position.x >= runtimeCanvas.width / 2);
      if (moving) player.position.x += dt * 3;
      if (jumping && player.position.y === 0) verticalVelocity = 5;
      verticalVelocity -= dt * 12;
      player.position.y = Math.max(0, player.position.y + verticalVelocity * dt);
      if (player.position.y === 0 && verticalVelocity < 0) verticalVelocity = 0;
      maxPointers = Math.max(maxPointers, pointers.length);
      movedWithTwoPointers ||= pointers.length >= 2 && moving;
      leftGroundWithTwoPointers ||= pointers.length >= 2 && player.position.y > 0;
      frameCtx.state.set({
        airborne: player.position.y > 0,
        currentPointers: pointers.length,
        leftGroundWithTwoPointers,
        maxPointers,
        movedWithTwoPointers,
      });
      status.frames += 1;
      if (status.frames === 1) console.info("TN_NATIVE_SMOKE_FIRST_FRAME");
      if (status.frames === 300) console.info("TN_NATIVE_SMOKE_300_FRAMES:300");
    };
  }
}

const game = defineGame<SmokeState>({
  canvas: runtimeCanvas,
  inputTarget: runtimeCanvas,
  plugins: __TN_PLAYTEST_ENABLED__ ? [playtest()] : [],
  scenes: { smoke: NativeSmoke },
  start: "smoke",
});

export default game;

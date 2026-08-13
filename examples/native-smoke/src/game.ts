import { type ICtx, Scene, defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import { BoxGeometry, Matrix4, Mesh, MeshBasicMaterial, Quaternion, Vector3 } from "three";

interface ISmokeState extends Record<string, unknown> {
  airborne: boolean;
  currentPointers: number;
  frames: number;
  leftGroundWithTwoPointers: boolean;
  maxPointers: number;
  movedWithTwoPointers: boolean;
}

export interface ISmokeStatus {
  error?: string;
  frames: number;
  ready: boolean;
  renderer?: string;
}

declare global {
  var canvas: HTMLCanvasElement | undefined;
}
declare const __TN_PLAYTEST_ENABLED__: boolean;
declare const __TN_JS_ENGINE_PROFILE__: Readonly<{
  extraDrawControl: boolean;
  frameWindow: number;
  materials: "distinct" | "shared";
  meshes: number;
  pureJsIterations: number;
  pureJsObjects: number;
  visibility: 0 | 0.25 | 0.5 | 1;
  warmupFrames: number;
}>;

export const status: ISmokeStatus = { frames: 0, ready: false };

const profile = __TN_JS_ENGINE_PROFILE__;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

function runPureJsProfile(): void {
  if (profile.pureJsObjects === 0 || profile.pureJsIterations === 0) return;
  const objects = Array.from({ length: profile.pureJsObjects }, (_, index) => ({
    local: new Matrix4(),
    parent: index === 0 ? -1 : Math.floor((index - 1) / 2),
    position: new Vector3(index % 17, (index % 31) * 0.1, (index % 47) * -0.1),
    quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), index * 0.001),
    scale: new Vector3(1, 1, 1),
    world: new Matrix4(),
  }));
  const samplesMs: number[] = [];
  let checksum = 0;
  for (let sample = -2; sample < 5; sample += 1) {
    const startedAt = performance.now();
    for (let iteration = 0; iteration < profile.pureJsIterations; iteration += 1) {
      for (let index = 0; index < objects.length; index += 1) {
        const object = objects[index];
        if (object === undefined) continue;
        object.position.x += 0.000001;
        object.local.compose(object.position, object.quaternion, object.scale);
        const parent = objects[object.parent];
        if (parent === undefined) object.world.copy(object.local);
        else object.world.multiplyMatrices(parent.world, object.local);
        checksum += object.world.elements[12] ?? 0;
      }
    }
    const elapsedMs = performance.now() - startedAt;
    if (sample >= 0) samplesMs.push(elapsedMs);
  }
  const operations = profile.pureJsObjects * profile.pureJsIterations;
  console.info(
    `TN_ANDROID_JS_PURE:${JSON.stringify({
      checksum: Number(checksum.toFixed(3)),
      iterations: profile.pureJsIterations,
      medianUsPerObject: (median(samplesMs) * 1000) / operations,
      objects: profile.pureJsObjects,
      samplesMs,
    })}`,
  );
}

function requireRuntimeCanvas(): HTMLCanvasElement {
  const value = globalThis.canvas;
  if (value === undefined)
    throw new Error("TN_NATIVE_CANVAS_MISSING: globalThis.canvas is required");
  return value;
}

const runtimeCanvas = requireRuntimeCanvas();
runtimeCanvas.style.touchAction = "none";

class NativeSmoke extends Scene<ISmokeState> {
  #profileFirstFrameAt: number | undefined;
  #profileFrames = 0;
  static override readonly initialState: ISmokeState = {
    airborne: false,
    currentPointers: 0,
    frames: 0,
    leftGroundWithTwoPointers: false,
    maxPointers: 0,
    movedWithTwoPointers: false,
  };

  override enter(ctx: ICtx<ISmokeState>) {
    ctx.camera.position.z = 3;
    const cube = ctx.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial({ color: 0x44aaff })));
    ctx.entities.add("cube", cube);
    const player = ctx.add(
      new Mesh(new BoxGeometry(0.4, 0.4, 0.4), new MeshBasicMaterial({ color: 0xffaa44 })),
    );
    player.position.set(-1, 0, 0);
    ctx.entities.add("multitouch-player", player);
    const queued = ctx.entities.add("queue-free-smoke", { dispose: () => undefined });
    ctx.entities.queueFree(queued);
    const sharedGeometry = new BoxGeometry(0.08, 0.08, 0.08);
    const sharedMaterial = new MeshBasicMaterial({ color: 0x88cc66 });
    const visibleMeshes = Math.floor(profile.meshes * profile.visibility);
    const perSide = Math.max(1, Math.ceil(Math.cbrt(profile.meshes)));
    for (let index = 0; index < profile.meshes; index += 1) {
      const material =
        profile.materials === "shared"
          ? sharedMaterial
          : new MeshBasicMaterial({ color: (0x224466 + index * 2654435761) & 0xffffff });
      const filler = ctx.add(new Mesh(sharedGeometry, material));
      filler.visible = index < visibleMeshes;
      filler.position.set(
        ((index % perSide) / perSide - 0.5) * 4,
        ((Math.floor(index / perSide) % perSide) / perSide - 0.5) * 4,
        ((Math.floor(index / (perSide * perSide)) % perSide) / perSide - 0.5) * 4,
      );
    }
    if (profile.extraDrawControl) {
      const controlDraw = ctx.add(new Mesh(sharedGeometry, sharedMaterial));
      controlDraw.position.set(0.25, 0.25, 0);
    }
    console.info(`TN_ANDROID_JS_SUBJECT:${JSON.stringify({ ...profile, visibleMeshes })}`);
    runPureJsProfile();
    let maxPointers = 0;
    let movedWithTwoPointers = false;
    let leftGroundWithTwoPointers = false;
    let verticalVelocity = 0;
    return (frameCtx: ICtx<ISmokeState>, dt: number) => {
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

  override render(): void {
    this.#profileFrames += 1;
    if (this.#profileFrames === profile.warmupFrames + 1) {
      this.#profileFirstFrameAt = performance.now();
      console.info(
        `TN_ANDROID_JS_WINDOW_START:${JSON.stringify({ frameWindow: profile.frameWindow })}`,
      );
    }
    if (this.#profileFrames !== profile.warmupFrames + profile.frameWindow + 1) return;
    const elapsedMs = performance.now() - (this.#profileFirstFrameAt ?? Number.NaN);
    if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
      console.error("TN_ANDROID_JS_FRAME_MISSING");
      return;
    }
    console.info(
      `TN_ANDROID_JS_FRAME:${JSON.stringify({
        elapsedMs,
        frames: profile.frameWindow,
        msPerFrame: elapsedMs / profile.frameWindow,
      })}`,
    );
  }
}

const game = defineGame<ISmokeState>({
  canvas: runtimeCanvas,
  inputTarget: runtimeCanvas,
  plugins: __TN_PLAYTEST_ENABLED__ ? [playtest()] : [],
  scenes: { smoke: NativeSmoke },
  start: "smoke",
});

export default game;

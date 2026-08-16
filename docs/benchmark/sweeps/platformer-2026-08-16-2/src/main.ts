import type { JsonValue } from "@threenative/playtest";
import { ACESFilmicToneMapping, PCFSoftShadowMap, SRGBColorSpace, WebGPURenderer } from "three/webgpu";
import { createGame } from "./game.js";
import { installHud } from "./hud.js";

const host = document.querySelector<HTMLElement>("#app");
if (!host) throw new Error("#app host element is missing from index.html");

const game = createGame();
const hud = installHud(host, game.level.coins.length);
window.game = game;

const renderer = new WebGPURenderer({ antialias: true, forceWebGL: false });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
renderer.outputColorSpace = SRGBColorSpace;
host.append(renderer.domElement);

const resize = (): void => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height);
  game.camera.aspect = width / height;
  game.camera.updateProjectionMatrix();
};
window.addEventListener("resize", resize);
resize();

// --- input -------------------------------------------------------------
const held = game.input;
window.addEventListener("keydown", (event: KeyboardEvent) => {
  held[event.code] = true;
  if (event.code === "Space") game.queueJump();
  if (event.code === "KeyR") game.restart();
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) {
    event.preventDefault();
  }
});
window.addEventListener("keyup", (event: KeyboardEvent) => {
  held[event.code] = false;
});
window.addEventListener("blur", () => {
  for (const key of Object.keys(held)) held[key] = false;
});

// --- fixed-step loop ---------------------------------------------------
const STEP = 1 / 60;
let accumulator = 0;
let previous = performance.now();
let frames = 0;
let fpsWindow = 0;
let fps = 0;

let ticks = 0;
const step = (): void => {
  game.tick(STEP);
  ticks += 1;
};

const frame = (): void => {
  const now = performance.now();
  const delta = Math.min(0.25, (now - previous) / 1000);
  previous = now;
  accumulator += delta;
  fpsWindow += delta;
  frames += 1;
  if (fpsWindow >= 0.5) {
    fps = Math.round(frames / fpsWindow);
    frames = 0;
    fpsWindow = 0;
  }
  let guard = 0;
  while (accumulator >= STEP && guard < 6) {
    step();
    accumulator -= STEP;
    guard += 1;
  }
  if (guard >= 6) accumulator = 0;
  hud.update(game.state);
  renderer.render(game.scene, game.camera);
  requestAnimationFrame(frame);
};

await renderer.init();
requestAnimationFrame(frame);

// --- observation bridge -------------------------------------------------
/** Which backend the renderer actually picked — a WebGL fallback must be visible, not silent. */
function backendName(): string {
  const backend = (renderer as unknown as { backend?: { isWebGPUBackend?: boolean } }).backend;
  return backend?.isWebGPUBackend === true ? "webgpu" : "webgl";
}

const { installThreePlaytestBridge } = await import("@threenative/playtest/three");
installThreePlaytestBridge({
  camera: game.camera,
  diagnostics: () => [
    { id: "fps", label: "FPS", value: fps },
    { id: "coins", label: "Coins", value: game.state.coins },
    { id: "backend", label: "Backend", value: backendName() },
  ],
  entities: game.entities,
  fixedStep: (ticks: number) => {
    for (let index = 0; index < ticks; index += 1) step();
    hud.update(game.state);
    renderer.render(game.scene, game.camera);
  },
  gameplay: () => ({
    animation: { player: { clip: game.state.goalReached ? "cheer" : "run", advancedFrames: 1 } },
    states: {
      player: game.state.goalReached ? "cheer" : "run",
      mission: game.state.goalReached ? "complete" : "playing",
    },
  }),
  renderer,
  scene: game.scene,
  tick: () => ticks,
  resources: { read: () => ({ state: { ...game.state } as unknown as JsonValue }) },
});

// convenience handle for any external harness or console poking
declare global {
  interface Window {
    game: typeof game;
    gpuAdapterInfo?: IAdapterInfo;
  }
}
// report the real adapter: a silent SwiftShader fallback must be visible in the page
interface IAdapterInfo {
  vendor: string;
  architecture: string;
  device: string;
  description: string;
}
const gpu = (navigator as unknown as {
  gpu?: { requestAdapter(): Promise<{ info: IAdapterInfo } | null> };
}).gpu;
if (gpu) {
  const adapter = await gpu.requestAdapter();
  if (adapter) {
    window.gpuAdapterInfo = {
      vendor: adapter.info.vendor,
      architecture: adapter.info.architecture,
      device: adapter.info.device,
      description: adapter.info.description,
    };
  }
}

import { Object3D, Scene } from "three";
import { vanillaBrowserRecording } from "./vanilla-browser-recording.js";

const scene = new Scene();
scene.add(new Object3D());
const initialHash = 2_168_613_626;
const hashStep = (hash: number, direction: number) =>
  Math.imul(hash ^ (direction + 1), 16_777_619) >>> 0;
const keys = new Set<string>();
globalThis.addEventListener("keydown", (event) => keys.add((event as KeyboardEvent).code));
globalThis.addEventListener("keyup", (event) => keys.delete((event as KeyboardEvent).code));

function hashOf(input: readonly number[]): number {
  let hash = initialHash;
  for (const direction of input) hash = hashStep(hash, direction);
  return hash;
}

function run(): { input: number[]; liveHash: number; replayHash: number } {
  const input = Array.from({ length: 24 }, () => (keys.has("KeyD") ? 1 : 0));
  return { input, liveHash: hashOf(input), replayHash: hashOf(input) };
}

export default {
  start: async () => {
    const { input, liveHash } = vanillaBrowserRecording;
    const replayHash = hashOf(input);
    console.info(
      `[PRD162-VANILLA] replay-consumed source=browser input=${JSON.stringify(input)} browserLiveHash=${liveHash} replayHash=${replayHash} match=${replayHash === liveHash}`,
    );
    return { input, liveHash, replayHash };
  },
};

Object.assign(globalThis, { __PRD162_VANILLA__: { run } });
const app = document.querySelector<HTMLElement>("#app");
if (app !== null) app.textContent = "Plain Three.js control arm";

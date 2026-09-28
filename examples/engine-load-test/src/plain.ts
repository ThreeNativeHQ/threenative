// The `plain-three-webgpu` control for PRD-449: the same Three.js bytes, the same authored scene,
// the same placement and clock, the same driver — and no framework code anywhere in the graph this
// page serves. It has no render projection and no stage profiler, so L3 and the culling A/B are not
// cells it can offer: those are the framework's, and a control that borrowed them would be measuring
// the framework twice. The Vite production build proves the graph; the collector proves the scene.
import { REVISION } from "three/webgpu";
import { type ILadderArm, runLadderArm } from "./driver.js";

const PLAIN_THREE_ARM: ILadderArm = {
  arm: "plain-three-webgpu",
  buildNotes: "plain three/webgpu control, no framework module in the served graph",
  engineName: "three",
  engineVersion: REVISION,
  rendererLabel: "three/webgpu WebGPURenderer",
};

async function main(): Promise<void> {
  const status = document.getElementById("status") as HTMLElement;
  const canvas = document.getElementById("stage") as HTMLCanvasElement;
  await runLadderArm(canvas, status, PLAIN_THREE_ARM);
}

const status = document.getElementById("status") as HTMLElement;
main().catch((error: unknown) => {
  status.textContent = `failed: ${String(error)}`;
  (globalThis as unknown as Record<string, unknown>).__ENGINE_LOAD_TEST_ERROR__ = String(error);
});

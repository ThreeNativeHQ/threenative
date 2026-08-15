// Native entry for the PRD-117 ThreeNative desktop/device arms. It drives the same ladder as the
// web entry against the same `game.ts`, and prints the §5.1 run report between two markers because
// a native host has no `window` for the collector to read.
import { VIEWPORT_HEIGHT, VIEWPORT_WIDTH, createLoadTestHarness } from "./game.js";
import { type RenderMode, percentile } from "./workload.js";

declare global {
  var canvas: HTMLCanvasElement | undefined;
}

declare const __TN_BENCH_CONFIG__: Readonly<{
  animate: boolean;
  frames: number;
  ladder: number[];
  modes: RenderMode[];
  repeats: number;
  warmup: number;
}>;

const config = __TN_BENCH_CONFIG__;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function main(): Promise<void> {
  const surface = globalThis.canvas;
  if (surface === undefined) throw new Error("TN_BENCH_NO_CANVAS");
  const harness = await createLoadTestHarness(surface, "native host surface", config.animate);
  const rungs: unknown[] = [];

  for (const objectCount of config.ladder) {
    for (const mode of config.modes) {
      for (let repeat = 0; repeat < config.repeats; repeat += 1) {
        console.log(`begin ${mode}@${objectCount}`);
        harness.setRung({ mode, objectCount });
        if (mode === "L3") {
          harness.beginCollapse();
          for (let settle = 0; settle < 5_000 && harness.collapseStatus() === "pending"; settle++) {
            // See the web entry: drawing one settle frame in eight keeps the host's frame pump
            // alive without paying the un-collapsed scene every iteration.
            harness.step(settle);
            if (settle % 8 === 0) await harness.render();
            // A settle that never finishes is otherwise indistinguishable from a slow one: the run
            // just never reports. Say where it is often enough to tell those apart.
            if (settle % 200 === 0) {
              console.log(
                `settle ${settle} status=${harness.collapseStatus()} moving=${harness.collapseMovingParts()}`,
              );
            }
            await nextFrame();
          }
          if (harness.collapseStatus() !== "applied")
            throw new Error(`TN_BENCH_COLLAPSE_${harness.collapseStatus().toUpperCase()}`);
          // Fail closed on the frozen scene: see the web entry for why a fast still picture is the
          // dangerous outcome here, not the good one.
          const moving = harness.collapseMovingParts();
          if (moving !== objectCount)
            throw new Error(`TN_BENCH_COLLAPSE_FROZE:${moving}/${objectCount}`);
        }
        const frameMs: number[] = [];
        // Split the frame in two: `stepMs` is the game-side transform loop, the remainder is the
        // renderer. Without the split a mobile regression cannot be attributed to either.
        const stepMs: number[] = [];
        const collapseMs: number[] = [];
        let drawCalls = 0;
        let triangles = 0;
        let visibleObjects = 0;
        let previous = performance.now();
        const statsFrame = Math.floor((config.frames + config.warmup) / 2);
        for (let frameIndex = 0; frameIndex < config.frames; frameIndex += 1) {
          harness.step(frameIndex);
          await harness.render();
          if (frameIndex === statsFrame) {
            const stats = harness.stats();
            drawCalls = stats.drawCalls;
            triangles = stats.triangles;
            visibleObjects = stats.visibleObjects;
          }
          await nextFrame();
          const now = performance.now();
          const interval = now - previous;
          previous = now;
          if (frameIndex >= config.warmup) {
            frameMs.push(Math.round(interval * 1000) / 1000);
            stepMs.push(Math.round(harness.stepMs * 1000) / 1000);
            collapseMs.push(Math.round(harness.collapseMs * 1000) / 1000);
          }
        }
        rungs.push({
          drawCalls,
          frameMs,
          stepMs,
          mode,
          objectCount,
          positionHash: harness.positionHash,
          repeat,
          triangles,
          visibleObjects,
        });
        console.log(
          `rung ${mode}@${objectCount} frame p50 ${percentile(frameMs, 0.5).toFixed(2)} | step p50 ${percentile(stepMs, 0.5).toFixed(2)} | collapse p50 ${percentile(collapseMs, 0.5).toFixed(2)} | game p50 ${(percentile(stepMs, 0.5) - percentile(collapseMs, 0.5)).toFixed(2)} ms | movingParts ${harness.collapseMovingParts()}`,
        );
      }
    }
  }

  // Read from the running platform, never hardcoded: a desktop label on a phone run would be
  // published as desktop evidence. The native host exposes no `navigator`, so the build stamps the
  // target in and the runtime confirms it.
  const scope = globalThis as unknown as { __TN_PLATFORM__?: string; process?: unknown };
  const onAndroid = scope.__TN_PLATFORM__ === "android";
  const report = {
    arm: onAndroid ? "tn-android" : "tn-desktop",
    build: {
      notes:
        "owned C++ runtime, three/webgpu render path; defineGame loop not in the measured path",
      type: "release",
    },
    device: { battery: null, label: "desktop-native-linux" },
    display: { height: VIEWPORT_HEIGHT, refreshHz: 60, vsync: false, width: VIEWPORT_WIDTH },
    driver: {
      adapter: harness.adapterLabel,
      renderer: "three/webgpu WebGPURenderer (native host)",
    },
    engine: { name: "threenative", version: "workspace" },
    rungs,
  };
  // Android's logcat truncates a line at ~1 KB, which silently cut every report this arm emitted
  // until the collector tried to parse one. The payload goes out in chunks and is rejoined.
  const payload = JSON.stringify(report);
  console.log("ENGINE_LOAD_TEST_JSON_BEGIN");
  for (let offset = 0; offset < payload.length; offset += 800) {
    console.log(`TNJSON:${payload.slice(offset, offset + 800)}`);
  }
  console.log("ENGINE_LOAD_TEST_JSON_END");
  harness.dispose();
}

main().catch((error: unknown) => {
  console.log(`ENGINE_LOAD_TEST_FAILED ${String(error)}`);
});

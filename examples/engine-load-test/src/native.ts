// Native entry for the PRD-117 ThreeNative desktop/device arms. It drives the same ladder as the
// web entry against the same `game.ts`, and prints the §5.1 run report between two markers because
// a native host has no `window` for the collector to read.
import { VIEWPORT_HEIGHT, VIEWPORT_WIDTH, createLoadTestHarness } from "./game.js";
import { type RenderMode, percentile } from "./workload.js";

declare global {
  var canvas: HTMLCanvasElement | undefined;
}

declare const __TN_PLATFORM__: string;

declare const __TN_BENCH_CONFIG__: Readonly<{
  animate: boolean;
  frames: number;
  refreshHz: number;
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
          // `projected` is the projection's applied state. The pass this replaced said `applied`;
          // both mean the same thing here, that the optimizer took the scene rather than handing
          // the frame back, and a rung that measured an un-optimized scene must still refuse to
          // report rather than publish L1 timings under an L3 label.
          if (harness.collapseStatus() !== "projected")
            throw new Error(`TN_BENCH_COLLAPSE_${harness.collapseStatus().toUpperCase()}`);
          // Fail closed on the frozen scene: see the web entry for why a fast still picture is the
          // dangerous outcome here, not the good one.
          const moving = harness.collapseMovingParts();
          if (moving < objectCount)
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

  // Declared, not read off `globalThis`: vite's `define` substitutes the bare identifier, so a
  // property access like `scope.__TN_PLATFORM__` is never replaced and silently reads undefined —
  // which filed every phone run as `tn-desktop`.
  const onAndroid = __TN_PLATFORM__ === "android";
  const presentMode =
    (globalThis as { __THREENATIVE_NATIVE__?: { presentMode?: string } }).__THREENATIVE_NATIVE__
      ?.presentMode ?? "fifo";
  const report = {
    arm: onAndroid ? "tn-android" : "tn-desktop",
    build: {
      notes:
        "owned C++ runtime, three/webgpu render path; defineGame loop not in the measured path",
      type: "release",
    },
    // Labelled from the target the binary was built for, not hardcoded. A phone run that files
    // itself as `desktop-native-linux @ 60 Hz` is mislabelled evidence, and `refreshHz` is not
    // cosmetic — the scorer refuses to compare two arms whose displays disagree.
    device: { battery: null, label: onAndroid ? "android-native" : "desktop-native-linux" },
    display: {
      height: VIEWPORT_HEIGHT,
      refreshHz: __TN_BENCH_CONFIG__.refreshHz,
      // Read back from the surface, never assumed: the host reports `fifo`, `immediate` or
      // `mailbox`, and only `fifo` pins frames to the display. Reporting `true` unconditionally is
      // how an uncapped run still described itself as display-bound.
      vsync: presentMode === "fifo",
      width: VIEWPORT_WIDTH,
    },
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
  // The log is not a reliable transport for a payload this size and the collector must not depend
  // on it alone. At 600 frames across a full ladder the report is well over a megabyte and goes out
  // in one burst; Android's logd rate-limits a single uid and silently discards most of it,
  // including the terminating marker the collector waits for. Enlarging the ring buffer does not
  // help, because the drop happens at write time rather than through eviction.
  //
  // So the report is also written to storage, where the collector can read it whole. The chunked
  // log emission below stays: it is the only path on hosts without persistent storage, and it is
  // what desktop already parses.
  try {
    globalThis.localStorage?.setItem("TN_BENCH_REPORT", payload);
  } catch {
    // Best effort. A host without storage still has the log path below.
  }
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

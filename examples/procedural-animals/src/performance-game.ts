import { type IFrameBudgetWindow, defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import { type IPhysicsContext, rapier } from "@threenative/physics";
import { Mesh } from "three";
import { type AnimalMode, Animals, type IAnimalsState } from "./Animals.js";
import { releaseAll } from "./cleanup.js";
import { observeAnimalSubmissions } from "./observe-submissions.js";
import {
  type AnimalPerformanceClock,
  readAnimalPerformanceClock,
  requireAnimalClockSpan,
  requireAnimalTickCoverage,
} from "./performance-clock.js";
import { AnimalPerformanceCollector, type GpuFrameObservation } from "./performance-collector.js";
import { performanceProjection } from "./render/performance-camera.js";

export function makeAnimalPerformanceGame(mode: Exclude<AnimalMode, "qualification">) {
  class Workload extends Animals {
    constructor() {
      super(mode);
    }
  }
  let requested = false;
  let consumeWindow: ((window: IFrameBudgetWindow) => void) | undefined;
  return defineGame<IAnimalsState, IPhysicsContext>({
    assets: { basePath: "" },
    input: { benchmark: { keys: ["KeyB"] } },
    plugins: [
      rapier(),
      playtest(),
      {
        beforeUpdate(ctx) {
          if (ctx.startup.phase === "ready" && ctx.input.justPressed("benchmark")) requested = true;
        },
        setup(ctx, runtime) {
          let live = true;
          let admitting = false;
          let clockStart: AnimalPerformanceClock | undefined;
          let previousWindowTick = runtime?.tick();
          let measurementStartTick: number | undefined;
          let measurementEndTick: number | undefined;
          let finished = false;
          let startedAt = 0;
          let compileCount: number | undefined;
          let surface: string | undefined;
          let collector: AnimalPerformanceCollector | undefined;
          let observer: GpuFrameObservation | undefined;
          let restoreSubmissions: (() => void) | undefined;
          const expected = mode === "baseline" ? 0 : mode === "high" ? 1 : 32;
          const release = () =>
            releaseAll([
              () => {
                restoreSubmissions?.();
                restoreSubmissions = undefined;
              },
              () => {
                collector?.dispose();
                collector = undefined;
              },
              () => {
                observer?.dispose();
                observer = undefined;
              },
            ]);
          const fail = (error: unknown) => {
            if (finished || !live) return;
            finished = true;
            let failure = error;
            try {
              release();
            } catch (cleanup) {
              failure = new AggregateError([error, cleanup], "TN_ANIMAL_PERFORMANCE_CLEANUP");
            }
            ctx.state.set({
              performanceFinished: true,
              performanceDone: false,
              performanceError: String(failure),
            });
            console.error(failure);
          };
          consumeWindow = (window) => {
            const previousTick = previousWindowTick;
            const tick = runtime?.tick();
            previousWindowTick = tick;
            if (!live || finished || !collector) return;
            try {
              const now = performance.now();
              if (now - startedAt > 120000)
                throw new Error("TN_ANIMAL_PERFORMANCE_OVERALL_TIMEOUT");
              if (ctx.renderer.compiling || ctx.renderer.compileCount !== compileCount)
                throw new Error("TN_ANIMAL_PERFORMANCE_COMPILATION_CHANGED");
              const drawn = window.surface;
              if (
                !drawn ||
                drawn.resolutionScale !== 1 ||
                drawn.scaleSource !== "pinned" ||
                drawn.compiling === true ||
                !Number.isSafeInteger(drawn.drawingBufferWidth) ||
                drawn.drawingBufferWidth <= 0 ||
                !Number.isSafeInteger(drawn.drawingBufferHeight) ||
                drawn.drawingBufferHeight <= 0 ||
                !Number.isSafeInteger(drawn.sampleCount) ||
                drawn.sampleCount <= 0
              )
                throw new Error("TN_ANIMAL_PERFORMANCE_SURFACE_UNAVAILABLE");
              const signature = JSON.stringify({
                scale: drawn.resolutionScale,
                source: drawn.scaleSource,
                width: drawn.drawingBufferWidth,
                height: drawn.drawingBufferHeight,
                samples: drawn.sampleCount,
              });
              if (surface !== undefined && signature !== surface)
                throw new Error("TN_ANIMAL_PERFORMANCE_SURFACE_CHANGED");
              surface = signature;
              if (previousTick === undefined || tick === undefined)
                throw new Error("TN_ANIMAL_PERFORMANCE_TICK_UNAVAILABLE");
              requireAnimalTickCoverage(previousTick, tick, window.substeps.mean);
              collector.cpu(window, now);
              if (collector.renderedFrames === 2100 && measurementEndTick === undefined)
                measurementEndTick = tick;
              const receipt = collector.poll(now);
              if (collector.renderedFrames % 300 === 0)
                ctx.state.set({ performanceFrames: collector.renderedFrames });
              if (!receipt) return;
              if (
                !clockStart ||
                measurementStartTick === undefined ||
                measurementEndTick === undefined
              )
                throw new Error("TN_ANIMAL_PERFORMANCE_CLOCK_UNAVAILABLE");
              requireAnimalTickCoverage(
                measurementStartTick,
                measurementEndTick,
                receipt.simulationSubsteps,
              );
              finished = true;
              const admitted = clockStart;
              const measuredSurface = JSON.parse(surface);
              void readAnimalPerformanceClock()
                .then((clockEnd) => {
                  if (!live) return;
                  requireAnimalClockSpan(admitted, clockEnd);
                  // Full rows are emitted only after measurement and bounded resolver drain complete.
                  console.log(
                    `TN_ANIMAL_PERFORMANCE_HEADER ${JSON.stringify({ mode, wolves: expected, vertices: ctx.state.getState().vertices, bones: ctx.state.getState().bones, surface: measuredSurface, renderer: ctx.renderer.kind, projection: performanceProjection, clock: { start: clockStart, end: clockEnd, measurementStartTick, measurementEndTick }, timestampInterval: 1, pixelRatio: 1, warmupFrames: receipt.warmupFrames, measuredFrames: receipt.measuredFrames, cpuRoundingUncertaintyMs: receipt.cpuRoundingUncertaintyMs })}`,
                  );
                  for (const [index, row] of [...receipt.warmup, ...receipt.measurement].entries())
                    console.log(`TN_ANIMAL_PERFORMANCE_ROW ${JSON.stringify({ index, ...row })}`);
                  console.log(
                    `TN_ANIMAL_PERFORMANCE_END ${JSON.stringify({ cpuP95Ms: receipt.cpuP95Ms, gpuP95Ms: receipt.gpuP95Ms, simulationSubsteps: receipt.simulationSubsteps, measuredSimulationSubsteps: receipt.measuredSimulationSubsteps, ignoredGpuFrames: receipt.ignoredGpuFrames, observerStatus: receipt.observerStatus })}`,
                  );
                  release();
                  ctx.state.set({
                    performanceFinished: true,
                    performanceDone: true,
                    performanceFrames: 2100,
                    performanceMeasuredFrames: 1800,
                    performanceCpuP95Ms: receipt.cpuP95Ms,
                    performanceGpuP95Ms: receipt.gpuP95Ms,
                    performanceError: null,
                  });
                })
                .catch((error: unknown) => {
                  finished = false;
                  fail(error);
                });
            } catch (error) {
              finished = false;
              fail(error);
            }
          };
          const remove = ctx.beforeRender(() => {
            if (
              !live ||
              finished ||
              collector ||
              !requested ||
              ctx.startup.phase !== "ready" ||
              ctx.renderer.compiling
            )
              return;
            if (!clockStart) {
              if (admitting) return;
              admitting = true;
              void readAnimalPerformanceClock()
                .then((clock) => {
                  if (live && !finished) clockStart = clock;
                  admitting = false;
                })
                .catch((error: unknown) => {
                  admitting = false;
                  fail(error);
                });
              return;
            }
            try {
              if (previousWindowTick === undefined)
                throw new Error("TN_ANIMAL_PERFORMANCE_TICK_UNAVAILABLE");
              measurementStartTick = previousWindowTick;
              const surfaces = new Map<number, Mesh>();
              ctx.scene.traverse((object) => {
                if (!object.name.startsWith("wolf-surface-")) return;
                const index = Number(object.name.slice("wolf-surface-".length));
                if (
                  !(object instanceof Mesh) ||
                  !Number.isSafeInteger(index) ||
                  index < 0 ||
                  index >= expected ||
                  surfaces.has(index) ||
                  !object.visible ||
                  !object.frustumCulled ||
                  !object.castShadow
                )
                  throw new Error("TN_ANIMAL_PERFORMANCE_SURFACES");
                surfaces.set(index, object);
              });
              if (surfaces.size !== expected) throw new Error("TN_ANIMAL_PERFORMANCE_SURFACES");
              const observe = ctx.renderer.observeGpuFrames;
              if (!observe) throw new Error("TN_ANIMAL_PERFORMANCE_GPU_OBSERVER_UNAVAILABLE");
              observer = observe.call(ctx.renderer, { maxFrames: 4096, maxQueries: 16384 });
              collector = new AnimalPerformanceCollector(expected, observer);
              const ordered = Array.from({ length: expected }, (_, index) => {
                const mesh = surfaces.get(index);
                if (!mesh) throw new Error("TN_ANIMAL_PERFORMANCE_SURFACES");
                return mesh;
              });
              restoreSubmissions = observeAnimalSubmissions(
                ctx.scene,
                ctx.camera,
                ordered,
                collector,
                () => live && !finished,
              );
              compileCount = ctx.renderer.compileCount;
              startedAt = performance.now();
              ctx.state.set({
                performanceStarted: true,
                performanceFinished: false,
                performanceDone: false,
                performanceFrames: 0,
                performanceError: null,
              });
            } catch (error) {
              fail(error);
            }
          });
          return () => {
            live = false;
            consumeWindow = undefined;
            releaseAll([remove, release]);
          };
        },
      },
    ],
    renderer: {
      preferWebGPU: true,
      pixelRatio: 1,
      resolutionScale: 1,
      gpuTimestampFrameInterval: 1,
    },
    camera: performanceProjection,
    frameBudget: {
      reportEvery: 1,
      report: () => {},
      onWindow: (window) => consumeWindow?.(window),
    },
    scenes: { animals: Workload },
    start: "animals",
    seed: 7,
  });
}

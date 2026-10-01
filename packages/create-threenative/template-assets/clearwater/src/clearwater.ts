import { type ICtx, RippleField, SpectralOcean, WaterSurface3D } from "@threenative/core";
import type { WebGPURenderer } from "three/webgpu";
import { DisposalScope } from "./clearwaterLifetime.js";
import { createClearwaterAppearance } from "./render/clearwater.js";
import {
  type IClearwaterOptions,
  type WaterRgb,
  finiteWaterNumber,
  resolveClearwaterOptions,
  waterSunDirection,
} from "./render/clearwaterOptions.js";

export type { IClearwaterOptions } from "./render/clearwaterOptions.js";
export type Clearwater = ReturnType<typeof createClearwater>;
type WaterContext = Pick<ICtx, "renderer" | "scene" | "camera" | "add" | "every" | "beforeRender">;

function isWebGPURenderer(value: unknown): value is WebGPURenderer {
  return (
    typeof value === "object" &&
    value !== null &&
    "isWebGPURenderer" in value &&
    value.isWebGPURenderer === true
  );
}

/**
 * One call, no render loop to install: the scene owns the clock, draw hook and removal lifecycle.
 * The mesh is horizontal, in world coordinates, and must remain an untransformed scene-root child.
 * Appearance lives in ./render/clearwater*.ts. Existing games can copy these generated source files.
 */
export function createClearwater(ctx: WaterContext, input: IClearwaterOptions = {}) {
  const options = resolveClearwaterOptions(input);
  const renderer = ctx.renderer.raw;
  if (ctx.renderer.kind !== "webgpu" || !isWebGPURenderer(renderer)) {
    throw new Error(
      "Clearwater requires ThreeNative's WebGPU renderer (FFT storage/compute); WebGL2 is not a supported fallback.",
    );
  }
  const scope = new DisposalScope();
  try {
    // Keep the simulation out of ctx.add(): this factory dispatches it once, immediately before
    // its caustic pass. Registering it with the engine as well would dispatch the FFT twice.
    const ocean = new SpectralOcean({
      resolution: options.resolution,
      cascades: [{ patchSize: 8 }, { patchSize: 2 }],
      amplitude: options.waveAmplitude,
      windSpeed: options.windSpeed,
      windDirection: 0.55,
      gravity: 9.81,
      directionality: 1.5,
      choppiness: 0,
      smallWaveCutoff: 0.08,
      seed: options.seed,
      cadence: "render",
      readbackResolution: 16,
      readbackEveryFrames: 3,
    });
    scope.defer(() => ocean.detach());
    const ripples = new RippleField({
      resolution: options.rippleResolution,
      size: options.rippleSize,
      speed: 1.2,
      damping: 0.9,
      maxSteps: 8,
    });
    ripples.recenter(options.center[0], options.center[1]);
    const surface = new WaterSurface3D({
      level: options.level,
      maxThickness: options.depth * 12,
      reflection: options.reflection
        ? {
            resolutionScale: options.reflectionScale,
            refreshInterval: options.reflectionRefreshInterval,
            layers: options.reflectionLayers,
          }
        : undefined,
    });
    scope.defer(() => surface.dispose());
    const appearance = createClearwaterAppearance(ocean, ripples, surface, options);
    scope.defer(() => appearance.dispose());
    scope.defer(() => appearance.mesh.removeFromParent());
    const onRemoved = () => scope.dispose();
    appearance.mesh.addEventListener("removed", onRemoved);
    scope.defer(() => appearance.mesh.removeEventListener("removed", onRemoved));
    let seconds = 0;
    const tick = ctx.every((dt) => {
      if (scope.disposed) return;
      seconds += dt;
      ocean.advance(seconds);
      ripples.advance(dt);
    });
    scope.defer(() => tick.cancel());
    const unhook = ctx.beforeRender(() => {
      if (scope.disposed) return;
      ocean.process(ctx.renderer);
      appearance.uploadRipples();
      appearance.caustics?.render(renderer);
    });
    scope.defer(unhook);
    ctx.add(appearance.mesh);

    const assertLive = () => {
      if (scope.disposed) throw new Error("Clearwater has been disposed.");
    };
    return {
      mesh: appearance.mesh,
      material: appearance.material,
      causticsTexture: appearance.caustics?.texture,
      ocean,
      ripples,
      get disposed(): boolean {
        return scope.disposed;
      },
      /** World-space disturbance. Returns false outside either the surface or the current patch. */
      disturb(x: number, z: number, radius = 0.2, strength = -0.04): boolean {
        assertLive();
        finiteWaterNumber("disturb.x", x);
        finiteWaterNumber("disturb.z", z);
        finiteWaterNumber("disturb.radius", radius);
        finiteWaterNumber("disturb.strength", strength);
        if (radius <= 0 || Math.abs(strength) > 10)
          throw new RangeError("Clearwater disturbance needs radius > 0 and |strength| <= 10.");
        if (
          Math.abs(x - options.center[0]) > options.size / 2 ||
          Math.abs(z - options.center[1]) > options.size / 2
        )
          return false;
        return ripples.impulse(x, z, radius, strength);
      },
      /** Keep the finite interaction grid near a character without tiling or wrapping old ripples. */
      follow(x: number, z: number): void {
        assertLive();
        ripples.recenter(x, z);
      },
      setLevel(value: number): void {
        assertLive();
        finiteWaterNumber("level", value);
        surface.setLevel(value);
        appearance.level.value = value;
      },
      setSunDirection(value: WaterRgb): void {
        assertLive();
        appearance.sunDirection.value.set(...waterSunDirection(value));
      },
      /** Undefined until GPU readback arrives. staleFrames covers the FFT, not the current CPU ripple. */
      sampleHeight(x: number, z: number) {
        assertLive();
        finiteWaterNumber("sampleHeight.x", x);
        finiteWaterNumber("sampleHeight.z", z);
        if (
          Math.abs(x - options.center[0]) > options.size / 2 ||
          Math.abs(z - options.center[1]) > options.size / 2
        )
          return undefined;
        const sample = ocean.sampleHeight(x, z);
        if (sample === undefined) return undefined;
        // Match rippleAt()'s two-texel smoothstep in render/clearwater.ts, including after follow().
        const edge =
          0.5 -
          Math.max(Math.abs(x - ripples.centerX), Math.abs(z - ripples.centerZ)) / ripples.size;
        const t = Math.max(0, Math.min(1, (edge * ripples.resolution) / 2));
        const rippleHeight = ripples.heightAt(x, z) * t * t * (3 - 2 * t);
        return {
          height: appearance.level.value + sample.height + rippleHeight,
          staleFrames: sample.staleFrames,
        };
      },
      dispose(): void {
        scope.dispose();
      },
    };
  } catch (error) {
    try {
      scope.dispose();
    } catch {
      /* Preserve the initialization failure, after releasing everything possible. */
    }
    throw error;
  }
}

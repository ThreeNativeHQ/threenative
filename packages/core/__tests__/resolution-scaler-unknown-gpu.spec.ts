import { describe, expect, it } from "vitest";
import { type IScalerWindow, ResolutionScaler } from "../src/resolution-scaler.js";

/**
 * Unknown GPU timing is not evidence of a GPU bottleneck.
 *
 * Midway's recurring-blur signature is 1920x1080 -> 998x562 (scale 0.52) on a window whose
 * deficit is measured in host fps, not GPU milliseconds: without fresh GPU timing one window
 * cannot separate fixed host cost from pixel cost, so sizing the jump from the fps deficit
 * attributes the whole host delay to pixels. The climb back costs five windows per rung, so a
 * multi-rung misstep under sustained host load reads as permanent.
 *
 * The fallback therefore probes instead of jumping: one rung down, refunded unless the next
 * decided window shows the frame rate improved past what motivated the probe. Backends without
 * timestamp queries keep a signal — probes that earn their keep walk down — but host-bound load
 * can never spend the picture to the floor.
 */
const targetFps = 60;

function scalerAt(start = 1): ResolutionScaler {
  const scaler = new ResolutionScaler({ start, targetFps });
  // Window 1 is warmup and always lies; consume it with a clean window.
  scaler.observe({
    fps: 60,
    presented: { max: 17, p50: 16.67, p95: 17, p99: 17 },
  });
  return scaler;
}

/** Host-overload window: fps far under target, presentation over budget, no usable GPU sample. */
function hostOverload(gpuMs?: number, gpuAgeFrames?: number): IScalerWindow {
  return {
    fps: 20,
    presented: { max: 60, p50: 50, p95: 55, p99: 58 },
    ...(gpuMs === undefined ? {} : { gpuMs }),
    ...(gpuAgeFrames === undefined ? {} : { gpuAgeFrames }),
  };
}

/** A window meeting the 60 fps target with a clean tail and no GPU timing. */
function cleanUnknown(): IScalerWindow {
  return { fps: 60, presented: { max: 17, p50: 16.67, p95: 17, p99: 17 } };
}

describe("ResolutionScaler with unknown GPU timing", () => {
  it("holds full resolution across sustained host overload with missing GPU timing", () => {
    const scaler = scalerAt();
    const stepped: (number | undefined)[] = [];
    for (let i = 0; i < 120; i += 1) stepped.push(scaler.observe(hostOverload()));
    // One probe rung spent, refunded when fewer pixels earned nothing, then held: the only
    // excursion in 120 windows.
    expect(stepped.filter((s) => s !== undefined)).toEqual([0.85, 1]);
    expect(scaler.scale).toBe(1);
    expect(scaler.scaleSource).toBe("auto");
    expect(scaler.atFloor).toBe(false);
  });

  it("holds full resolution across sustained host overload with stale GPU timing", () => {
    const scaler = scalerAt();
    for (let i = 0; i < 30; i += 1) scaler.observe(hostOverload(7, 9));
    expect(scaler.scale).toBe(1);
    expect(scaler.atFloor).toBe(false);
  });

  it("does not spend a rung on a transient gap after fresh-healthy GPU timing", () => {
    const scaler = scalerAt();
    scaler.observe({
      fps: 60,
      gpuMs: 7,
      gpuAgeFrames: 3,
      presented: { max: 17, p50: 16.67, p95: 17, p99: 17 },
    });
    expect(scaler.observe(hostOverload())).toBeUndefined();
    expect(scaler.scale).toBe(1);
    // A second consecutive gap is no longer transient: it probes, one rung only.
    expect(scaler.observe(hostOverload())).toBe(0.85);
  });

  it("walks down while fewer pixels keep improving the frame rate, then refunds", () => {
    // Earning is priced on the same rung table as every sized jump: 20 -> 25 prices 4 -> 3
    // rungs, 25 -> 35 prices 3 -> 2, so each probe is kept. A flat repeat prices the same and
    // refunds only the last unearned rung.
    const scaler = scalerAt();
    const improved = (fps: number): IScalerWindow => ({ ...hostOverload(), fps });
    expect(scaler.observe(improved(20))).toBe(0.85);
    scaler.observe(cleanUnknown()); // resize cooldown, discarded
    expect(scaler.observe(improved(25))).toBe(0.72);
    scaler.observe(cleanUnknown()); // resize cooldown, discarded
    expect(scaler.observe(improved(35))).toBe(0.61);
    scaler.observe(cleanUnknown()); // resize cooldown, discarded
    // Improvement stopped: the last unearned rung is refunded, earned rungs stand.
    expect(scaler.observe(improved(35))).toBe(0.72);
    expect(scaler.scale).toBe(0.72);
  });

  it("refunds a probe parked at the final rung instead of reporting atFloor forever", () => {
    // The defect this pins: the floor guard ran before probe evaluation, so a probe from 0.27
    // to 0.23 followed by an unchanged frame rate set atFloor and returned there forever.
    const scaler = scalerAt(0.27);
    expect(scaler.observe(hostOverload())).toBe(0.23);
    scaler.observe(hostOverload()); // resize cooldown, discarded
    expect(scaler.observe(hostOverload())).toBe(0.27);
    for (let i = 0; i < 10; i += 1) scaler.observe(hostOverload());
    expect(scaler.scale).toBe(0.27);
    expect(scaler.atFloor).toBe(false);
  });

  it("does not ratchet down on monotonically noisy CPU-only timings", () => {
    // 20, 20.01, 20.02, ... never crosses a rung boundary in the deficit pricing, so no probe
    // is ever earned: one rung spent, refunded, then held, however long the tremor lasts.
    const scaler = scalerAt();
    const stepped: (number | undefined)[] = [];
    for (let i = 0; i < 60; i += 1) {
      stepped.push(scaler.observe({ ...hostOverload(), fps: 20 + i * 0.01 }));
    }
    expect(stepped.filter((s) => s !== undefined)).toEqual([0.85, 1]);
    expect(scaler.scale).toBe(1);
    expect(scaler.atFloor).toBe(false);
  });

  it("recovers the probed rung through the normal climb once pressure lifts", () => {
    const scaler = scalerAt();
    expect(scaler.observe(hostOverload())).toBe(0.85);
    scaler.observe(cleanUnknown()); // resize cooldown, discarded
    for (let i = 0; i < 3; i += 1) expect(scaler.observe(cleanUnknown())).toBeUndefined();
    expect(scaler.observe(cleanUnknown())).toBe(1);
    expect(scaler.scale).toBe(1);
  });

  it("still sizes GPU-overload drops from fresh GPU cost", () => {
    expect(scalerAt().observe(hostOverload(40, 3))).toBe(0.61);
  });
});

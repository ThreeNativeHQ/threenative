import { describe, expect, it, vi } from "vitest";
import {
  RESOLUTION_SCALER,
  RESOLUTION_SCALE_INSENSITIVE_MARKER,
  ResolutionScaler,
} from "../src/resolution-scaler.js";

/**
 * The insensitivity guard: pixels spent on a frame that does not get faster are pixels thrown away.
 *
 * A real browser arm (machinefall map-walk flyover, RTX 2080 under Xvfb) settled at scale 0.23 and
 * stayed there while the frame did not move: `GPU p50` 4-11 ms at 0.23 against 6-20 ms at scale 1.
 * The remaining cost was geometry and shadow-map work, so a 120 fps target was unreachable and the
 * picture was surrendered for nothing. Lowering scale is only paid when the measured GPU time falls
 * with the pixels.
 */

const TARGET = 120;
/** A window whose fps follows the GPU cost and whose tail is its own period, so nothing stalls. */
const windowAt = (gpuMs: number) => {
  const fps = Math.min(TARGET, 1000 / gpuMs);
  const period = 1000 / fps;
  return {
    fps,
    gpuMs,
    gpuAgeFrames: 3,
    presented: { max: period, p50: period, p95: period, p99: period },
  };
};

/** Cost that does not depend on pixel count: the scene is bound by geometry and shadow maps. */
const insensitive = (): number => 9;
/** The pixel-bound control: the brief's `gpuMs = 2 + 12 * scale^2`. */
const pixelBound = (scale: number): number => 2 + 12 * scale * scale;

/** Feeds windows whose GPU cost is the curve evaluated at the scale the scaler is holding. */
function feedCurve(
  scaler: ResolutionScaler,
  cost: (scale: number) => number,
  windows: number,
): void {
  for (let i = 0; i < windows; i += 1) scaler.observe(windowAt(cost(scaler.scale)));
}

describe("ResolutionScaler against a workload that does not answer to pixels", () => {
  it("holds the sharp rung instead of walking to the floor", () => {
    const scaler = new ResolutionScaler({ targetFps: TARGET });
    feedCurve(scaler, insensitive, 40);
    expect(scaler.scale).toBeGreaterThanOrEqual(0.9);
  });

  it("still walks a pixel-bound curve down to the rung it always did", () => {
    const scaler = new ResolutionScaler({ targetFps: TARGET });
    feedCurve(scaler, pixelBound, 40);
    expect(scaler.scale).toBe(0.72);
  });

  it("re-probes after the measured cost rises past the remembered one", () => {
    const scaler = new ResolutionScaler({ targetFps: TARGET });
    feedCurve(scaler, insensitive, 20);
    expect(scaler.scale).toBeGreaterThanOrEqual(0.9);
    // The workload changes: the same yaw now costs 12 ms, a third more than the remembered 9.
    for (let i = 0; i < RESOLUTION_SCALER.insensitiveResetWindows; i += 1)
      scaler.observe(windowAt(12));
    expect(scaler.scale).toBeLessThan(0.9);
  });

  it("emits one marker naming both scales and the relative gain", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const scaler = new ResolutionScaler({ targetFps: TARGET });
      feedCurve(scaler, insensitive, 8);
      expect(info).toHaveBeenCalledWith(
        `${RESOLUTION_SCALE_INSENSITIVE_MARKER} scale=0.85 restored=1 gainPct=0`,
      );
    } finally {
      info.mockRestore();
    }
  });
});

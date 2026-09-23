import { describe, expect, it } from "vitest";
import { RippleField } from "../src/ripple-field.js";

const field = (extra: Partial<{ speed: number; damping: number }> = {}) =>
  new RippleField({ resolution: 96, size: 192, damping: 0.02, ...extra });

/** Drive the field the way a game loop does. One `advance` deliberately clamps to `maxSteps`. */
const run = (f: RippleField, seconds: number): void => {
  for (let t = 0; t < seconds; t += 1 / 60) f.advance(1 / 60);
};

describe("RippleField", () => {
  it("defaults to a display-rate step, never above the CFL limit", () => {
    const f = field();
    expect(f.step).toBeLessThanOrEqual(f.dx / (f.speed * Math.SQRT2));
    // A coarse patch has a lot of CFL headroom; taking all of it would step the water at 5 Hz.
    expect(f.step).toBeCloseTo(1 / 60, 6);
    // A fine patch is stability-bound instead, and the default follows it down.
    const fine = new RippleField({ resolution: 512, size: 64, speed: 40 });
    expect(fine.step).toBeLessThan(1 / 60);
    expect(() => new RippleField({ resolution: 96, size: 192, step: 1 })).toThrow(/CFL/);
  });

  it("is flat until something hits it", () => {
    const f = field();
    run(f, 1);
    expect(f.energy()).toBe(0);
    expect(f.heightAt(0, 0)).toBe(0);
  });

  it("injects no net volume, so repeated splashes cannot raise the sea", () => {
    const f = field();
    const mean = () => f.height.reduce((a, b) => a + b, 0) / f.height.length;
    for (let i = 0; i < 12; i++) {
      f.impulse(0, 0, 6, -40);
      run(f, 0.05);
    }
    // A naive Gaussian would have pumped in 12 impulses' worth of displaced water by now.
    expect(Math.abs(mean())).toBeLessThan(1e-3);
    expect(f.energy()).toBeGreaterThan(0);
  });

  it("carries a ring outward at roughly the stated celerity", () => {
    const f = field({ speed: 20 });
    f.impulse(0, 0, 4, -60);
    const probe = 40;
    const arrival = probe / f.speed;
    run(f, arrival * 0.4);
    // The front cannot outrun its own celerity.
    expect(Math.abs(f.heightAt(probe, 0))).toBeLessThan(1e-3);
    run(f, arrival * 1.1);
    expect(Math.abs(f.heightAt(probe, 0))).toBeGreaterThan(1e-3);
  });

  it("absorbs at the rim instead of reflecting, and forgets the disturbance", () => {
    const f = field();
    f.impulse(0, 0, 5, -60);
    run(f, 20);
    const settled = f.energy();
    f.impulse(0, 0, 5, -60);
    const struck = f.energy();
    expect(settled).toBeLessThan(struck * 0.05);
  });

  it("rejects an impulse outside the patch and accepts it again after recentring", () => {
    const f = field();
    expect(f.impulse(400, 0, 5, -40)).toBe(false);
    f.recenter(400, 0);
    expect(f.centerX).toBeCloseTo(Math.round(400 / f.dx) * f.dx, 6);
    expect(f.impulse(400, 0, 5, -40)).toBe(true);
  });

  it("keeps a disturbance in world space when the patch moves under it", () => {
    const f = field();
    f.impulse(0, 0, 6, -60);
    run(f, 0.2);
    const before = f.heightAt(0, 0);
    expect(Math.abs(before)).toBeGreaterThan(1e-3);
    f.recenter(30, 18);
    // The shift is by whole cells, so the same world point reads back the same height.
    expect(f.heightAt(0, 0)).toBeCloseTo(before, 5);
  });

  it("drifts foam with the current and decays it", () => {
    const f = new RippleField({
      resolution: 96,
      size: 192,
      foamHalfLife: 4,
      current: { x: 8, z: 0 },
    });
    f.depositFoam(0, 0, 4, 1);
    const planted = f.foamAt(0, 0);
    expect(planted).toBeGreaterThan(0.5);
    run(f, 2);
    expect(f.foamAt(16, 0)).toBeGreaterThan(f.foamAt(-16, 0));
    run(f, 20);
    expect(f.foamAt(0, 0)).toBeLessThan(planted * 0.2);
  });

  it("reports flow including the steady current", () => {
    const f = new RippleField({ resolution: 64, size: 128, current: { x: 2, z: -1 } });
    expect(f.flowAt(0, 0)).toEqual({ x: 2, z: -1 });
  });

  it("bumps version only when a cell changed", () => {
    const f = field();
    const start = f.version;
    // A partial step runs no whole step, so nothing changed.
    f.advance(f.step / 4);
    expect(f.version).toBe(start);
    // Whole steps over a flat patch change nothing either: the laplacian of zero is zero. This
    // used to announce a new texture image sixty times a second for a grid that was still zero.
    f.advance(f.step * 2);
    expect(f.version).toBe(start);
    // A disturbance is what makes a cell change, and then every solving step is a new image.
    f.impulse(0, 0, 6, -40);
    const disturbed = f.version;
    expect(disturbed).toBeGreaterThan(start);
    f.advance(f.step * 2);
    expect(f.version).toBeGreaterThan(disturbed);
  });

  it("reads zero outside the patch rather than clamping to the rim", () => {
    const f = field();
    f.impulse(0, 0, 6, -60);
    run(f, 0.1);
    expect(f.heightAt(1e5, 0)).toBe(0);
    expect(f.foamAt(0, 1e5)).toBe(0);
  });
});

describe("RippleField on an exactly empty patch", () => {
  it("advances its clocks on the same schedule as a disturbed one, without solving", () => {
    const empty = field();
    const busy = field();
    busy.impulse(0, 0, 6, -40);
    const emptyVersion = empty.version;
    for (let i = 0; i < 90; i++) {
      expect(empty.advance(1 / 60)).toBe(busy.advance(1 / 60));
      expect(empty.time).toBeCloseTo(busy.time, 12);
    }
    // Time passing over a flat patch produced no new texture image; the disturbed one produced many.
    expect(empty.version).toBe(emptyVersion);
    expect(busy.version).toBeGreaterThan(emptyVersion + 80);
    expect(empty.energy()).toBe(0);
  });

  it("runs no steps at all for a paused frame", () => {
    const f = field();
    expect(f.advance(0)).toBe(0);
    expect(f.time).toBe(0);
    expect(f.version).toBe(0);
  });

  it("wakes on the first impulse after any amount of calm", () => {
    const f = field();
    run(f, 30);
    const quiet = f.version;
    expect(f.impulse(0, 0, 6, -40)).toBe(true);
    expect(f.version).toBe(quiet + 1);
    f.advance(1 / 60);
    expect(f.version).toBe(quiet + 2);
    expect(f.energy()).toBeGreaterThan(0);
    // The ring really propagates, so the sleep never cost a frame of the disturbance.
    run(f, 0.4);
    expect(Math.max(...f.height)).toBeGreaterThan(0);
  });

  it("wakes on foam alone, with no pressure impulse at all", () => {
    const f = field();
    run(f, 5);
    const quiet = f.version;
    expect(f.depositFoam(0, 0, 3, 0.8)).toBe(true);
    expect(f.version).toBe(quiet + 1);
    expect(Math.max(...f.foam)).toBeGreaterThan(0);
    f.advance(1 / 60);
    // Foam transport is now running again: the version moves on a step that solves.
    expect(f.version).toBe(quiet + 2);
  });

  it("validates its arguments before any fast return", () => {
    const f = field();
    expect(() => f.recenter(Number.NaN, 0)).toThrow(/must be finite/);
    expect(() => f.impulse(Number.NaN, 0, 6, -40)).toThrow(/must be finite/);
    expect(() => f.impulse(0, 0, 0, -40)).toThrow(/radius/);
    expect(() => f.depositFoam(0, 0, 3, -1)).toThrow(/non-negative/);
    expect(() => f.advance(-1)).toThrow(/dt must be finite/);
    expect(f.version).toBe(0);
  });

  it("follows the camera across cell after cell without uploading a zero grid", () => {
    const f = field();
    const start = f.version;
    for (let i = 1; i <= 40; i++) {
      f.recenter(i * f.dx * 1.4, -i * f.dx * 0.9);
      f.advance(1 / 60);
    }
    // The centre really moved, by whole cells, and not one new texture image was announced.
    expect(f.centerX).toBeGreaterThan(30 * f.dx);
    expect(f.centerZ).toBeLessThan(-20 * f.dx);
    expect(f.centerX / f.dx).toBeCloseTo(Math.round(f.centerX / f.dx), 9);
    expect(f.version).toBe(start);
    expect(f.heightAt(f.centerX, f.centerZ)).toBe(0);
  });

  it("still clears the previous image once when a disturbed patch jumps clear away", () => {
    const f = field();
    f.impulse(0, 0, 6, -40);
    run(f, 0.2);
    expect(f.energy()).toBeGreaterThan(0);
    const before = f.version;
    f.recenter(f.size * 20, 0);
    // One bump: the GPU still holds the old rings and has to be told they are gone.
    expect(f.version).toBe(before + 1);
    expect(f.energy()).toBe(0);
    // And from here it is exactly empty again, so following the camera is free once more.
    const cleared = f.version;
    f.recenter(f.size * 20 + f.dx * 3, f.dx * 7);
    f.advance(1 / 60);
    expect(f.version).toBe(cleared);
  });

  it("shifts a live disturbance rather than sleeping through it", () => {
    const f = field();
    f.impulse(0, 0, 6, -40);
    run(f, 0.2);
    const before = f.version;
    f.recenter(f.dx * 4, 0);
    expect(f.version).toBe(before + 1);
    expect(f.energy()).toBeGreaterThan(0);
    f.advance(1 / 60);
    expect(f.version).toBe(before + 2);
  });

  it("never sleeps on a small but real wave, however long it has been running", () => {
    const f = field({ damping: 1.4 });
    f.impulse(0, 0, 6, -40);
    run(f, 25);
    // Long decayed and far below any epsilon a sleep heuristic would pick, and still not asleep:
    // the field has no idea whether the game can see this water.
    const faint = f.energy();
    expect(faint).toBeGreaterThan(0);
    expect(faint).toBeLessThan(1e-6);
    const before = f.version;
    f.advance(1 / 60);
    expect(f.version).toBe(before + 1);
  });

  it("is exactly empty again after reset, and cheap again with it", () => {
    const f = field();
    f.impulse(0, 0, 6, -40);
    run(f, 0.3);
    f.reset();
    expect(f.energy()).toBe(0);
    const after = f.version;
    f.advance(1 / 60);
    f.recenter(f.dx * 9, f.dx * 9);
    expect(f.version).toBe(after);
    // And it still wakes properly from there.
    f.impulse(f.dx * 9, f.dx * 9, 6, -40);
    expect(f.version).toBe(after + 1);
  });
});

describe("RippleField on a non-event", () => {
  it("accepts a zero impulse and a zero foam deposit without claiming anything changed", () => {
    const f = field();
    // A game that scales its impulse by the frame delta hands these in on every paused frame.
    expect(f.impulse(0, 0, 6, 0, 0)).toBe(true);
    expect(f.depositFoam(0, 0, 3, 0)).toBe(true);
    expect(f.version).toBe(0);
    expect(f.energy()).toBe(0);
    // And the patch is still exactly empty, so it still follows the camera for free.
    f.recenter(f.dx * 5, f.dx * 5);
    f.advance(1 / 60);
    expect(f.version).toBe(0);
    // A real one still wakes it.
    expect(f.impulse(f.dx * 5, f.dx * 5, 6, -40)).toBe(true);
    expect(f.version).toBe(1);
  });
  // `#integrate` computes the breaking-crest gradient magnitude with `Math.sqrt` of the squares
  // rather than `Math.hypot`, because V8's hypot pays for an overflow-safe scaling pass and ran
  // 6.4x slower per cell, which made it the largest single cost in the solver. The two are NOT
  // bit-identical: sqrt-of-squares loses up to 2 ulp when one component is negligible beside the
  // other. That is licensed here and nowhere else, because this magnitude reaches only `foam` —
  // never `height` and never `velocity` — so no float, hull pose or height query can observe it.
  it("computes a gradient magnitude within 2 ulp of Math.hypot across the solver's range", () => {
    const bits = new DataView(new ArrayBuffer(16));
    const ulpsApart = (a: number, b: number): number => {
      bits.setFloat64(0, a);
      bits.setFloat64(8, b);
      const left = bits.getBigUint64(0);
      const right = bits.getBigUint64(8);
      return Number(left > right ? left - right : right - left);
    };
    const values = [0, 1e-8, -1e-8, 1e-6, -1e-6, 0.29, 0.3, 0.31, 1, -1, 9, -9, 50, -50];
    for (let i = 0; i < 200; i++) values.push(-50 + (i * 100) / 199);
    let worst = 0;
    for (const gx of values)
      for (const gz of values)
        worst = Math.max(worst, ulpsApart(Math.sqrt(gx * gx + gz * gz), Math.hypot(gx, gz)));
    expect(worst).toBeLessThanOrEqual(2);
  });

  it("keeps a struck field finite and its foam inside the unit range", () => {
    const f = field();
    expect(f.impulse(0, 0, 6, -40)).toBe(true);
    run(f, 1);
    for (const h of f.height) expect(Number.isFinite(h)).toBe(true);
    for (const c of f.foam) {
      expect(Number.isFinite(c)).toBe(true);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });
});

import { describe, expect, it, vi } from "vitest";
import { StartupReadiness } from "../src/startup-readiness.js";

describe("StartupReadiness", () => {
  it("waits for compile work and consecutive in-budget frames", async () => {
    let resolveCompile: () => void = () => undefined;
    const readiness = new StartupReadiness({
      compileBudgetMs: 1_000,
      frameBudgetMs: 50,
      stableFrames: 3,
    });
    let ready = false;
    void readiness.whenReady().then(() => {
      ready = true;
    });

    readiness.start(
      () =>
        new Promise<void>((resolve) => {
          resolveCompile = resolve;
        }),
    );
    readiness.observe(1);
    readiness.observe(1);
    readiness.observe(1);
    await Promise.resolve();
    expect(ready).toBe(false);

    resolveCompile();
    for (let index = 0; index < 6; index += 1) await Promise.resolve();
    readiness.observe(50);
    readiness.observe(51);
    readiness.observe(50);
    readiness.observe(50);
    expect(ready).toBe(false);
    readiness.observe(50);
    for (let index = 0; index < 2; index += 1) await Promise.resolve();

    expect(ready).toBe(true);
  });

  it("does not wait forever for a native compile promise", async () => {
    vi.useFakeTimers();
    try {
      const readiness = new StartupReadiness({
        compileBudgetMs: 100,
        frameBudgetMs: 50,
        stableFrames: 2,
      });
      let ready = false;
      void readiness.whenReady().then(() => {
        ready = true;
      });

      readiness.start(() => new Promise<void>(() => undefined));
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      readiness.observe(50);
      readiness.observe(50);
      await Promise.resolve();

      expect(ready).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not wait forever when no frame meets the budget", async () => {
    // A low-end host can run its whole steady state above the frame budget; the loading screen
    // still has to come down eventually or every template's world pass stays skipped for good.
    vi.useFakeTimers();
    try {
      const readiness = new StartupReadiness({
        compileBudgetMs: 1_000,
        frameBudgetMs: 50,
        stableFrames: 2,
        stableWindowMs: 2_000,
      });
      let ready = false;
      void readiness.whenReady().then(() => {
        ready = true;
      });

      readiness.start(() => undefined);
      await Promise.resolve();
      // Every frame misses the budget, which under the counting rule alone never reaches readiness.
      for (let index = 0; index < 10; index += 1) {
        readiness.observe(120);
      }
      await Promise.resolve();
      expect(ready).toBe(false);

      await vi.advanceTimersByTimeAsync(2_001);
      expect(ready).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels the stable-window fallback once counting reaches readiness first", async () => {
    vi.useFakeTimers();
    try {
      const onSettled = vi.fn<() => void>();
      const readiness = new StartupReadiness({
        compileBudgetMs: 60_000,
        frameBudgetMs: 50,
        stableFrames: 2,
        stableWindowMs: 5_000,
      });
      void readiness.whenReady().then(onSettled);

      readiness.start(() => undefined);
      // Let the deferred compile settle so the frame counter starts counting.
      for (let index = 0; index < 3; index += 1) await Promise.resolve();
      readiness.observe(10);
      readiness.observe(10);
      await Promise.resolve();
      expect(readiness.ready).toBe(true);

      // The late fallback must not re-resolve or fire after counting already got there.
      await vi.advanceTimersByTimeAsync(10_000);
      expect(onSettled).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("StartupReadiness holds", () => {
  /** Drive the framework's own gate to done, so only the holds are left. */
  const frameworkReady = async (readiness: StartupReadiness): Promise<void> => {
    readiness.start();
    for (let index = 0; index < 6; index += 1) await Promise.resolve();
    for (let index = 0; index < 3; index += 1) readiness.observe(1);
    for (let index = 0; index < 4; index += 1) await Promise.resolve();
  };

  it("keeps startup unresolved until the game's own work settles", async () => {
    const readiness = new StartupReadiness({ stableFrames: 3 });
    let ready = false;
    void readiness.whenReady().then(() => {
      ready = true;
    });
    let landDetail: () => void = () => undefined;
    readiness.hold(
      "detail-tier",
      new Promise<void>((resolve) => {
        landDetail = resolve;
      }),
    );

    await frameworkReady(readiness);
    // This is the whole defect: the framework is done, and the world is not.
    expect(readiness.frameworkReady).toBe(true);
    expect(readiness.ready).toBe(false);
    expect(ready).toBe(false);
    expect(readiness.pendingHolds).toEqual(["detail-tier"]);

    landDetail();
    for (let index = 0; index < 4; index += 1) await Promise.resolve();
    expect(readiness.ready).toBe(true);
    expect(ready).toBe(true);
    expect(readiness.pendingHolds).toEqual([]);
    expect(readiness.holdReport).toEqual([{ expired: false, label: "detail-tier" }]);
  });

  it("resolves on a rejected hold rather than trapping the player behind it", async () => {
    const readiness = new StartupReadiness({ stableFrames: 3 });
    readiness.hold("detail-tier", Promise.reject(new Error("a texture 404'd")));
    await frameworkReady(readiness);
    for (let index = 0; index < 4; index += 1) await Promise.resolve();
    expect(readiness.ready).toBe(true);
    // Rejection is settlement, not expiry: the work finished, it just failed.
    expect(readiness.holdReport).toEqual([{ expired: false, label: "detail-tier" }]);
  });

  it("expires a hold that never settles, and says so", async () => {
    vi.useFakeTimers();
    try {
      const readiness = new StartupReadiness({ holdBudgetMs: 5_000, stableFrames: 3 });
      readiness.hold("never", new Promise<void>(() => undefined));
      readiness.start();
      await vi.advanceTimersByTimeAsync(1);
      for (let index = 0; index < 3; index += 1) readiness.observe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(readiness.ready).toBe(false);
      await vi.advanceTimersByTimeAsync(5_001);
      expect(readiness.ready).toBe(true);
      expect(readiness.holdReport).toEqual([{ expired: true, label: "never" }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for every hold, not just the last one registered", async () => {
    const readiness = new StartupReadiness({ stableFrames: 3 });
    let landSky: () => void = () => undefined;
    readiness.hold("detail-tier", Promise.resolve());
    readiness.hold(
      "sky",
      new Promise<void>((resolve) => {
        landSky = resolve;
      }),
    );
    await frameworkReady(readiness);
    expect(readiness.ready).toBe(false);
    expect(readiness.pendingHolds).toEqual(["sky"]);
    landSky();
    for (let index = 0; index < 4; index += 1) await Promise.resolve();
    expect(readiness.ready).toBe(true);
  });

  it("refuses a duplicate label and a hold that arrives after startup resolved", async () => {
    const readiness = new StartupReadiness({ stableFrames: 3 });
    readiness.hold("detail-tier", Promise.resolve());
    expect(() => readiness.hold("detail-tier", Promise.resolve())).toThrow(
      /TN_STARTUP_HOLD_DUPLICATE/,
    );
    expect(() => readiness.hold("  ", Promise.resolve())).toThrow(/TN_STARTUP_HOLD_LABEL_INVALID/);
    await frameworkReady(readiness);
    for (let index = 0; index < 4; index += 1) await Promise.resolve();
    expect(readiness.ready).toBe(true);
    // Silently accepting this is what makes `timeline.readyMs` describe a moment nobody had.
    expect(() => readiness.hold("late", Promise.resolve())).toThrow(/TN_STARTUP_HOLD_TOO_LATE/);
  });

  it("changes nothing for a game that registers no hold", async () => {
    const readiness = new StartupReadiness({ stableFrames: 3 });
    await frameworkReady(readiness);
    expect(readiness.frameworkReady).toBe(true);
    expect(readiness.ready).toBe(true);
    expect(readiness.holdReport).toEqual([]);
  });

  it("resolves framework readiness before the holds, so a game can sequence work off it", async () => {
    // The deadlock this exists to prevent, in miniature. A game that starts its held work from
    // `whenReady()` is waiting for a gate that is waiting for it; only the hold budget breaks the
    // cycle, and it presents as a very slow asset load rather than as a hang.
    const readiness = new StartupReadiness({ stableFrames: 3 });
    const order: string[] = [];
    let landDetail: () => void = () => undefined;
    readiness.hold(
      "detail-tier",
      new Promise<void>((resolve) => {
        landDetail = resolve;
      }),
    );
    void readiness.whenFrameworkReady().then(() => {
      order.push("framework");
      // This is the shape a game wants: begin the tier once the framework is done competing for
      // the main thread, and let the gate wait for it.
      landDetail();
    });
    void readiness.whenReady().then(() => order.push("world"));

    readiness.start();
    for (let index = 0; index < 6; index += 1) await Promise.resolve();
    for (let index = 0; index < 3; index += 1) readiness.observe(1);
    for (let index = 0; index < 8; index += 1) await Promise.resolve();

    expect(order).toEqual(["framework", "world"]);
    expect(readiness.ready).toBe(true);
    expect(readiness.holdReport).toEqual([{ expired: false, label: "detail-tier" }]);
  });

  it("resolves framework readiness even while a hold is still outstanding", async () => {
    const readiness = new StartupReadiness({ stableFrames: 3 });
    let frameworkReady = false;
    readiness.hold("detail-tier", new Promise<void>(() => undefined));
    void readiness.whenFrameworkReady().then(() => {
      frameworkReady = true;
    });
    readiness.start();
    for (let index = 0; index < 6; index += 1) await Promise.resolve();
    for (let index = 0; index < 3; index += 1) readiness.observe(1);
    for (let index = 0; index < 6; index += 1) await Promise.resolve();
    expect(frameworkReady).toBe(true);
    expect(readiness.ready).toBe(false);
  });
});

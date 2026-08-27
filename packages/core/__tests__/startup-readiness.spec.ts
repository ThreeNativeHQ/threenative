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

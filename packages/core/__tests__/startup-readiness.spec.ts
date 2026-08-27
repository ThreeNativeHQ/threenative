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
});

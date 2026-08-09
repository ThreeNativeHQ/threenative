import { assertCondition, startBehaviorScene } from "./scene-support.js";

export function startScene(canvas, dimensions) {
  return startBehaviorScene(canvas, dimensions, "performance-now", async () => {
    assertCondition(
      typeof globalThis.performance?.now === "function",
      "performance.now must exist",
    );
    const before = globalThis.performance.now();
    await Promise.resolve();
    const after = globalThis.performance.now();
    assertCondition(
      Number.isFinite(before) && Number.isFinite(after),
      "performance.now must be finite",
    );
    assertCondition(after >= before, "performance.now must be monotonic");
    return { monotonic: true };
  });
}

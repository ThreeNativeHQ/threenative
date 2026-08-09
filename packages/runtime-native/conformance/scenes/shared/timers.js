import { assertCondition, startBehaviorScene } from "./scene-support.js";

export function startScene(canvas, dimensions) {
  return startBehaviorScene(canvas, dimensions, "timers", async () => {
    let cancelledFired = false;
    const cancelled = setTimeout(() => {
      cancelledFired = true;
    }, 0);
    clearTimeout(cancelled);
    let intervalCount = 0;
    await new Promise((resolve) => {
      const interval = setInterval(() => {
        intervalCount += 1;
        clearInterval(interval);
        resolve();
      }, 1);
    });
    assertCondition(!cancelledFired, "clearTimeout must prevent the callback");
    assertCondition(intervalCount === 1, "clearInterval must stop repeated callbacks");
    return { intervalCount };
  });
}

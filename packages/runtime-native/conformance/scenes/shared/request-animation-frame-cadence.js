import { assertCondition, startBehaviorScene } from "./scene-support.js";

export function startScene(canvas, dimensions) {
  return startBehaviorScene(canvas, dimensions, "request-animation-frame-cadence", async () => {
    const timestamps = [];
    await new Promise((resolve) => {
      function sample(timestamp) {
        timestamps.push(timestamp);
        if (timestamps.length === 3) resolve();
        else requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    });
    assertCondition(
      timestamps.every(Number.isFinite),
      "requestAnimationFrame timestamps must be finite",
    );
    assertCondition(
      timestamps[0] <= timestamps[1] && timestamps[1] <= timestamps[2],
      "requestAnimationFrame timestamps must be monotonic",
    );
    return { samples: timestamps.length };
  });
}

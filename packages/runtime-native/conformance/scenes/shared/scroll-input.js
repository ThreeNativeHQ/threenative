import { InputMap } from "../../../../core/src/input.js";
import { assertCondition, startBehaviorScene } from "./scene-support.js";

export async function startScene(canvas, dimensions) {
  return startBehaviorScene(canvas, dimensions, "scroll-input", async () => {
    const input = new InputMap({ zoom: { scroll: true } }, globalThis, canvas, () => []);
    try {
      globalThis.dispatchEvent(new globalThis.WheelEvent("wheel", { deltaY: -32 }));
      input.tick();
      const axis = input.axis("zoom");
      assertCondition(axis > 0, `native host scroll produced ${axis}, expected a positive zoom axis`);
      return { axis };
    } finally {
      input.dispose();
    }
  });
}

import { InputMap } from "../../../../core/src/input.js";
import { assertCondition, startBehaviorScene } from "./scene-support.js";

function waitForNativeWheel(input) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, axis) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      globalThis.removeEventListener("wheel", onWheel);
      if (error === undefined) resolve(axis);
      else reject(error);
    };
    const onWheel = () => {
      input.tick();
      const axis = input.axis("zoom");
      if (axis !== 0) finish(undefined, axis);
    };
    const timeout = setTimeout(() => {
      finish(new Error("Native host did not deliver an SDL wheel event to the DOM listener."));
    }, 1000);
    globalThis.addEventListener("wheel", onWheel);
  });
}

export async function startScene(canvas, dimensions) {
  return startBehaviorScene(canvas, dimensions, "scroll-input", async () => {
    const input = new InputMap({ zoom: { scroll: true } }, globalThis, canvas, () => []);
    try {
      // The native host must deliver the physical SDL wheel through processMouseWheel and its
      // DOM dispatch path; this scene deliberately never constructs or dispatches a wheel event.
      const axis = await waitForNativeWheel(input);
      assertCondition(axis > 0, `native host scroll produced ${axis}, expected positive intent`);
      return { axis };
    } finally {
      input.dispose();
    }
  });
}

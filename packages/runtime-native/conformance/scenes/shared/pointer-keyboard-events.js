import { assertCondition, startBehaviorScene } from "./scene-support.js";
import { InputMap } from "../../../../core/src/input.js";

export function startScene(canvas, dimensions) {
  return startBehaviorScene(canvas, dimensions, "pointer-keyboard-events", () => {
    const seen = [];
    canvas.addEventListener("pointerdown", (event) => seen.push(`pointer:${event.pointerId}`));
    window.addEventListener("keydown", (event) => seen.push(`key:${event.code}`));
    canvas.dispatchEvent(
      new PointerEvent("pointerdown", { pointerId: 7, pointerType: "touch", clientX: 12 }),
    );
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", code: "KeyA" }));
    assertCondition(seen.includes("pointer:7"), "pointer event must reach canvas listeners");
    assertCondition(seen.includes("key:KeyA"), "keyboard event must reach window listeners");
    if (globalThis.__TN_CONFORMANCE_TARGET__ === "native") {
      const input = new InputMap({ look: { pointerRelative: true } }, globalThis, canvas, () => []);
      for (const pointerType of ["touch", "pen"]) {
        canvas.dispatchEvent(new PointerEvent("click", { pointerType }));
        assertCondition(
          !input.raw.pointer.captured,
          `${pointerType} clicks must not enter relative mouse capture`,
        );
      }
      canvas.dispatchEvent(new Event("click"));
      assertCondition(
        input.raw.pointer.captured,
        "native relative pointer bindings must capture on a canvas click by default",
      );
      input.dispose();
    }
    return { events: seen };
  });
}

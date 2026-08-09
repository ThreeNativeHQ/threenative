import { assertCondition, startBehaviorScene } from "./scene-support.js";

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
    return { events: seen };
  });
}

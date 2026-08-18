import { describe, expect, it } from "vitest";
import { InputMap } from "../src/input.js";

function mouseMove(movementX: number, movementY: number): Event {
  const event = new Event("mousemove");
  Object.defineProperties(event, {
    movementX: { value: movementX },
    movementY: { value: movementY },
  });
  return event;
}

describe("InputMap relative pointer look", () => {
  it("accumulates mouse deltas, samples them on tick, and then clears the raw delta", () => {
    const target = new EventTarget();
    const input = new InputMap({ look: { pointerRelative: true } }, target);

    target.dispatchEvent(mouseMove(3, -5));
    target.dispatchEvent(mouseMove(4, 2));

    expect(input.raw.pointer.relative.toArray()).toEqual([7, -3]);
    input.tick();

    expect(input.raw.pointer.relative.toArray()).toEqual([0, 0]);
    expect(input.vector("look").toArray()).toEqual([7, -3]);

    input.tick();
    expect(input.vector("look").toArray()).toEqual([0, 0]);
    input.dispose();
  });

  it("reports capture state through the input API", () => {
    const target = new EventTarget() as EventTarget & {
      exitPointerLock: () => void;
      requestPointerLock: () => void;
    };
    target.requestPointerLock = () => undefined;
    target.exitPointerLock = () => undefined;
    const input = new InputMap(undefined, target, target);

    input.captureMouse();
    expect(input.raw.pointer.captured).toBe(true);
    input.releaseMouse();
    expect(input.raw.pointer.captured).toBe(false);
    input.dispose();
  });
});

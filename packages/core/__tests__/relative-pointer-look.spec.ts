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

  it("captures the pointer on a canvas click for relative pointer bindings", () => {
    const inputTarget = new EventTarget();
    const canvas = new EventTarget() as EventTarget & { requestPointerLock: () => void };
    let requests = 0;
    canvas.requestPointerLock = () => {
      requests += 1;
    };
    const input = new InputMap({ look: { pointerRelative: true } }, inputTarget, canvas);

    canvas.dispatchEvent(new Event("click"));
    canvas.dispatchEvent(new Event("click"));

    expect(requests).toBe(1);
    expect(input.raw.pointer.captured).toBe(true);
    input.dispose();
    canvas.dispatchEvent(new Event("click"));
    expect(requests).toBe(1);
  });

  it("allows a relative binding to keep capture under an explicit gesture", () => {
    const inputTarget = new EventTarget();
    const canvas = new EventTarget() as EventTarget & { requestPointerLock: () => void };
    let requests = 0;
    canvas.requestPointerLock = () => {
      requests += 1;
    };
    const input = new InputMap(
      { look: { captureOnClick: false, pointerRelative: true } },
      inputTarget,
      canvas,
    );

    canvas.dispatchEvent(new Event("click"));
    expect(requests).toBe(0);
    input.captureMouse();
    expect(requests).toBe(1);
    input.dispose();
  });

  it.each(["touch", "pen"])("does not request mouse lock for a %s click", (pointerType) => {
    const target = new EventTarget();
    const canvas = new EventTarget() as EventTarget & { requestPointerLock: () => void };
    let requests = 0;
    canvas.requestPointerLock = () => {
      requests += 1;
    };
    const input = new InputMap({ look: { pointerRelative: true } }, target, canvas);
    const click = new Event("click");
    Object.defineProperty(click, "pointerType", { value: pointerType });
    canvas.dispatchEvent(click);
    expect(requests).toBe(0);
    expect(input.raw.pointer.captured).toBe(false);

    const mouseClick = new Event("click");
    Object.defineProperty(mouseClick, "pointerType", { value: "mouse" });
    canvas.dispatchEvent(mouseClick);
    expect(requests).toBe(1);
    expect(input.raw.pointer.captured).toBe(true);
    input.dispose();
  });

  it("surfaces an unavailable automatic capture target", () => {
    const inputTarget = new EventTarget();
    const canvas = new EventTarget();
    let clickListener: EventListener | undefined;
    const addEventListener = canvas.addEventListener.bind(canvas);
    canvas.addEventListener = ((type, listener, options) => {
      if (type === "click" && typeof listener === "function") clickListener = listener;
      addEventListener(type, listener, options);
    }) as typeof canvas.addEventListener;
    const input = new InputMap({ look: { pointerRelative: true } }, inputTarget, canvas);

    if (clickListener === undefined) throw new Error("automatic capture click listener is missing");
    expect(() => clickListener?.(new Event("click"))).toThrow(/Pointer capture is unavailable/u);
    input.dispose();
  });
});

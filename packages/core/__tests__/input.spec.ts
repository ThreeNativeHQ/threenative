import { describe, expect, it } from "vitest";
import { InputMap } from "../src/input.js";

function keyEvent(type: string, code: string): Event {
  const event = new Event(type);
  Object.defineProperty(event, "code", { value: code });
  return event;
}

function pointerEvent(
  type: string,
  id: number,
  x: number,
  y: number,
  buttons = type === "pointerup" || type === "pointercancel" ? 0 : 1,
): Event {
  return Object.assign(new Event(type), { buttons, clientX: x, clientY: y, pointerId: id });
}

describe("InputMap", () => {
  it("should report (-1, 0) when KeyA is held", () => {
    const target = new EventTarget();
    const input = new InputMap(undefined, target);

    target.dispatchEvent(keyEvent("keydown", "KeyA"));

    expect(input.vector("move").toArray()).toEqual([-1, 0]);
    input.dispose();
  });

  it("should return +y when the up binding is held", () => {
    const target = new EventTarget();
    const input = new InputMap(undefined, target);

    target.dispatchEvent(keyEvent("keydown", "KeyW"));

    expect(input.vector("move").y).toBe(1);
    input.dispose();
  });

  it("should return +y for a forward gamepad stick", () => {
    const target = new EventTarget();
    const input = new InputMap(undefined, target, target, () => [{ axes: [0, -1], buttons: [] }]);

    input.tick();

    expect(input.vector("move").y).toBe(1);
    input.dispose();
  });

  it("should clear held keys on window blur", () => {
    const target = new EventTarget();
    const input = new InputMap(undefined, target);
    target.dispatchEvent(keyEvent("keydown", "KeyA"));
    target.dispatchEvent(pointerEvent("pointerdown", 7, 12, 34));

    target.dispatchEvent(new Event("blur"));

    expect(input.vector("move").toArray()).toEqual([0, 0]);
    expect(input.raw.pointer.position.toArray()).toEqual([0, 0]);
    expect(input.raw.pointers.size).toBe(0);
    input.dispose();
  });

  it("reports held pointers in arrival order and moves only the matching pointer", () => {
    const target = new EventTarget();
    const input = new InputMap(undefined, target);

    target.dispatchEvent(pointerEvent("pointerdown", 7, 10, 20));
    target.dispatchEvent(pointerEvent("pointerdown", 3, 80, 90));
    target.dispatchEvent(pointerEvent("pointermove", 3, 81, 92));

    expect([...input.raw.pointers.keys()]).toEqual([7, 3]);
    expect(input.raw.pointers.get(7)?.position.toArray()).toEqual([10, 20]);
    expect(input.raw.pointers.get(3)?.position.toArray()).toEqual([81, 92]);
    expect(input.raw.pointer).toMatchObject({ buttons: 1, down: true });
    expect(input.raw.pointer.position.toArray()).toEqual([10, 20]);
    input.dispose();
  });

  it("does not capture an untrusted pointer event injected by a browser proof", () => {
    const target = new EventTarget() as EventTarget & {
      setPointerCapture: (id: number) => void;
    };
    target.setPointerCapture = () => {
      throw new Error("synthetic pointer capture must not be requested");
    };
    const input = new InputMap(undefined, target);

    expect(() => target.dispatchEvent(pointerEvent("pointerdown", 7, 10, 20))).not.toThrow();
    expect(input.raw.pointers.size).toBe(1);
    input.dispose();
  });

  it("releases one pointer without disturbing the other and promotes the next primary", () => {
    const target = new EventTarget();
    const input = new InputMap({ fire: { pointer: true } }, target);
    target.dispatchEvent(pointerEvent("pointerdown", 7, 10, 20));
    target.dispatchEvent(pointerEvent("pointerdown", 3, 80, 90));

    target.dispatchEvent(pointerEvent("pointerup", 7, 12, 22));

    expect([...input.raw.pointers.keys()]).toEqual([3]);
    expect(input.raw.pointer.down).toBe(true);
    expect(input.raw.pointer.position.toArray()).toEqual([80, 90]);
    expect(input.pressed("fire")).toBe(true);
    target.dispatchEvent(pointerEvent("pointerup", 3, 80, 90));
    expect(input.raw.pointers.size).toBe(0);
    expect(input.raw.pointer.down).toBe(false);
    input.dispose();
  });

  it("releases a cancelled pointer and leaves other held pointers active", () => {
    const target = new EventTarget();
    const input = new InputMap(undefined, target);
    target.dispatchEvent(pointerEvent("pointerdown", 7, 10, 20));
    target.dispatchEvent(pointerEvent("pointerdown", 3, 80, 90));

    target.dispatchEvent(pointerEvent("pointercancel", 3, 80, 90));

    expect([...input.raw.pointers.keys()]).toEqual([7]);
    expect(input.raw.pointer.position.toArray()).toEqual([10, 20]);
    input.dispose();
  });

  it("updates legacy hover position only when no pointer is held", () => {
    const target = new EventTarget();
    const input = new InputMap(undefined, target);
    target.dispatchEvent(pointerEvent("pointermove", 1, 5, 6, 0));
    expect(input.raw.pointer.position.toArray()).toEqual([5, 6]);
    target.dispatchEvent(pointerEvent("pointerdown", 7, 10, 20));
    target.dispatchEvent(pointerEvent("pointermove", 1, 50, 60, 0));
    expect(input.raw.pointer.position.toArray()).toEqual([10, 20]);
    input.dispose();
  });

  it("should report justPressed and justReleased on one transition frame", () => {
    const target = new EventTarget();
    const input = new InputMap({ jump: { down: ["Space"] } }, target);

    target.dispatchEvent(keyEvent("keydown", "Space"));
    input.tick();
    expect(input.justPressed("jump")).toBe(true);
    expect(input.justReleased("jump")).toBe(false);

    input.tick();
    input.tick();
    expect(input.justPressed("jump")).toBe(false);

    target.dispatchEvent(keyEvent("keyup", "Space"));
    input.tick();
    expect(input.justReleased("jump")).toBe(true);
    input.tick();
    expect(input.justReleased("jump")).toBe(false);
    input.dispose();
  });

  it("should not report a bound action when an unbound gamepad button is down", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        getGamepads: () => [
          {
            axes: [],
            buttons: [{ pressed: false }, { pressed: true }],
          } as unknown as Gamepad,
        ],
      },
    });
    const input = new InputMap({ jump: { buttons: [0] } }, new EventTarget());

    try {
      input.tick();
      expect(input.pressed("jump")).toBe(false);
    } finally {
      input.dispose();
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, "navigator");
      else Object.defineProperty(globalThis, "navigator", descriptor);
    }
  });

  // `keys` exists because `down` reads as "the keys that press this action" while it means
  // "the −y direction of the axis". A build bound `jump: { down: ["Space"] }`, which worked,
  // then found `pressed("move")` true whenever ArrowDown was held. See the round 9 friction
  // ledger, docs/verification/sweep-platformer-2026-08-16.md.
  it("should press a button action bound with keys", () => {
    const target = new EventTarget();
    const input = new InputMap({ jump: { keys: ["Space"] } }, target);

    target.dispatchEvent(keyEvent("keydown", "Space"));
    input.tick();

    expect(input.pressed("jump")).toBe(true);
    expect(input.justPressed("jump")).toBe(true);
    input.dispose();
  });

  it("should keep keys out of the action vector", () => {
    const target = new EventTarget();
    const input = new InputMap({ aim: { keys: ["KeyS", "ArrowDown"] } }, target);

    target.dispatchEvent(keyEvent("keydown", "ArrowDown"));

    expect(input.vector("aim").toArray()).toEqual([0, 0]);
    expect(input.pressed("aim")).toBe(true);
    input.dispose();
  });

  it("should still press an action bound the older way, with down", () => {
    const target = new EventTarget();
    const input = new InputMap({ jump: { down: ["Space"] } }, target);

    target.dispatchEvent(keyEvent("keydown", "Space"));

    expect(input.pressed("jump")).toBe(true);
    input.dispose();
  });
});

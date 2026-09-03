import { readFile } from "node:fs/promises";
import path from "node:path";
import { Vector2 } from "three";
import { describe, expect, it } from "vitest";
import {
  stickDeflection,
  touchControlPoint,
} from "../templates/platformer/src/render/touch-layout.js";

const RADIUS = 72;

/**
 * The thumbstick's contract, as arithmetic.
 *
 * This exists because the bug it guards against was invisible to every automated check the repo
 * had: the control responded, the pointer counts were right, the frame rate was fine, and the
 * game was simply unplayable with a thumb. It was found by a person holding a phone, which is the
 * most expensive way to find anything.
 *
 * What went wrong was that deflection was measured from the drawn circle rather than from where
 * the thumb landed. On a Pixel 8 in landscape a touch at (600, 540) — a perfectly ordinary place
 * to put a thumb — reported x=0.818, z=-0.576 before any drag, so pressing right sent the
 * character diagonally. Anchoring is what fixes it, and these are the assertions that would have
 * caught it on the way in.
 */
describe("platformer thumbstick", () => {
  it("reads zero at the moment the thumb lands, wherever it lands", () => {
    // The regression, stated directly: the landing spot is the origin, not a direction.
    for (const landing of [new Vector2(600, 540), new Vector2(120, 980), new Vector2(20, 20)]) {
      const move = stickDeflection(landing, landing, RADIUS);
      expect(move.x).toBe(0);
      expect(move.y).toBe(0);
    }
  });

  it("reads a drag as a direction relative to the landing spot", () => {
    const landing = new Vector2(600, 540);
    const right = stickDeflection(landing, new Vector2(600 + RADIUS, 540), RADIUS);
    expect(right.x).toBeCloseTo(1);
    expect(right.y).toBeCloseTo(0);

    const left = stickDeflection(landing, new Vector2(600 - RADIUS, 540), RADIUS);
    expect(left.x).toBeCloseTo(-1);
    expect(left.y).toBeCloseTo(0);

    // Screen y grows downward; the game's move.y is +up, so dragging up must read positive.
    const up = stickDeflection(landing, new Vector2(600, 540 - RADIUS), RADIUS);
    expect(up.y).toBeCloseTo(1);
    expect(up.x).toBeCloseTo(0);

    const down = stickDeflection(landing, new Vector2(600, 540 + RADIUS), RADIUS);
    expect(down.y).toBeCloseTo(-1);
    expect(down.x).toBeCloseTo(0);
  });

  it("never reports past full deflection however far the thumb travels", () => {
    const landing = new Vector2(600, 540);
    const move = stickDeflection(
      landing,
      new Vector2(600 + RADIUS * 40, 540 - RADIUS * 40),
      RADIUS,
    );
    expect(move.x).toBe(1);
    expect(move.y).toBe(1);
  });

  /**
   * A drag of the same shape must mean the same thing from anywhere on the pad. This is the
   * property the fixed-centre version broke: identical drags produced different vectors depending
   * only on where the thumb happened to start.
   */
  it("gives the same vector for the same drag from any landing spot", () => {
    const drag = new Vector2(30, -45);
    const first = stickDeflection(new Vector2(120, 980), new Vector2(150, 935), RADIUS);
    const second = stickDeflection(new Vector2(700, 600), new Vector2(730, 555), RADIUS);
    expect(first.x).toBeCloseTo(second.x);
    expect(first.y).toBeCloseTo(second.y);
    expect(first.x).toBeCloseTo(drag.x / RADIUS);
  });

  it("keeps the resting controls inside the viewport it is given", () => {
    for (const size of [
      { height: 1080, width: 2400 },
      { height: 2400, width: 1080 },
      { height: 720, width: 1280 },
    ]) {
      for (const name of ["move", "dash", "jump"] as const) {
        const point = touchControlPoint(size, name);
        expect(point.x).toBeGreaterThan(0);
        expect(point.y).toBeGreaterThan(0);
        expect(point.x).toBeLessThan(size.width);
        expect(point.y).toBeLessThan(size.height);
      }
    }
  });
});

const TOUCH_TEMPLATES = [
  "action-rpg",
  "minimal",
  "platformer",
  "racing",
  "sailing",
  "shooter",
  "starter",
] as const;

describe("template touch controls", () => {
  it.each(TOUCH_TEMPLATES)("keeps %s controls in its own render source", async (template) => {
    const source = await readFile(
      path.resolve(
        `packages/create-threenative/templates/${template}/src/render/touch-controls.ts`,
      ),
      "utf8",
    );

    expect(source).toContain("class TouchControls");
    expect(source).toContain("readonly object");
    expect(source).not.toMatch(/@threenative\/(?:core|ui)/u);
  });

  it("wires sailing touch movement through its scene and ship", async () => {
    const [scene, ship] = await Promise.all([
      readFile(
        path.resolve("packages/create-threenative/templates/sailing/src/scenes/Sailing.ts"),
        "utf8",
      ),
      readFile(
        path.resolve("packages/create-threenative/templates/sailing/src/entities/Ship.ts"),
        "utf8",
      ),
    ]);

    expect(scene).toContain("const showTouchControls = isMobile() && isTouchscreenAvailable();");
    expect(scene).toContain('ctx.entities.add("touch-controls", new TouchControls(camera))');
    expect(scene).toContain("touchControls?.update(frameCtx.input.raw.pointers");
    expect(ship).toContain('import type { ITouchInput } from "../render/touch-controls.js";');
    expect(ship).toContain("touch.move");
    expect(ship).toContain("move.clampLength(0, 1)");
  });
});

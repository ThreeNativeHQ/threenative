import { describe, expect, it } from "vitest";
import { FixedStepLoop, afterPhysics, createAfterPhysicsPhase } from "../src/loop.js";

describe("afterPhysics", () => {
  it("should run after the solver has written transforms when a body moved this step", () => {
    const body = { position: { y: 0 } };
    let observedY = -1;
    const loop = new FixedStepLoop({
      onUpdate: () => {
        body.position.y = 2;
      },
      onAfterPhysics: () => {
        observedY = body.position.y;
      },
    });

    loop.start(0);
    loop.advance(1);

    expect(observedY).toBe(2);
  });

  it("should keep the phase between simulation and rendering and support disposal", () => {
    const events: string[] = [];
    const phase = createAfterPhysicsPhase();
    const dispose = afterPhysics({ afterPhysics: (callback) => phase.register(callback) }, () =>
      events.push("afterPhysics"),
    );
    const loop = new FixedStepLoop({
      onAfterPhysics: (dt) => phase.run(dt),
      onRender: () => {
        events.push("render");
        return undefined;
      },
      onUpdate: () => events.push("physics"),
    });

    loop.start(0);
    loop.advance(1);
    loop.stepFrame(0);
    dispose();
    phase.run(1 / 60);

    expect(events).toEqual(["physics", "afterPhysics", "render"]);
  });
});

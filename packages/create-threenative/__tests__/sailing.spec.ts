import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => {
  const order: string[] = [];
  const ocean = {
    advance: vi.fn((seconds: number) => order.push(`ocean:${seconds}`)),
  };
  const ship = {
    capsize: vi.fn(),
    immersion: 0,
    mesh: { position: { z: 0 } },
    update: vi.fn(() => order.push("ship")),
    updateVisual: vi.fn(() => order.push("visual")),
    visual: { position: { y: 0 } },
  };
  return { ocean, order, ship };
});

vi.mock("@threenative/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@threenative/core")>();
  return {
    ...actual,
    isMobile: () => false,
    isTouchscreenAvailable: () => false,
  };
});

vi.mock("../templates/sailing/src/entities/Ship.js", () => ({
  Ship: vi.fn(function ShipMock() {
    return fixture.ship;
  }),
}));
vi.mock("../templates/sailing/src/render/camera.js", () => ({
  followShip: vi.fn(),
  setupCamera: vi.fn(),
}));
vi.mock("../templates/sailing/src/render/lighting.js", () => ({
  setupLighting: vi.fn(() => ({})),
}));
vi.mock("../templates/sailing/src/render/loading.js", () => ({
  createLoadingScreen: vi.fn(() => ({ update: vi.fn() })),
}));
vi.mock("../templates/sailing/src/render/materials.js", () => ({
  createMaterials: vi.fn(() => ({})),
}));
vi.mock("../templates/sailing/src/render/ocean.js", () => ({
  createOcean: vi.fn(() => fixture.ocean),
  createWaterMesh: vi.fn(() => ({})),
}));
vi.mock("../templates/sailing/src/render/postprocessing.js", () => ({
  setupPost: vi.fn(),
}));
vi.mock("../templates/sailing/src/render/props.js", () => ({
  createBuoy: vi.fn(() => ({ position: { set: vi.fn() } })),
  createIsland: vi.fn(() => ({})),
}));
vi.mock("../templates/sailing/src/render/sky.js", () => ({
  setupSky: vi.fn(),
}));

import { Sailing } from "../templates/sailing/src/scenes/Sailing.js";

/**
 * The scene's own context, with the state object it mutates handed back so a case can read the
 * status the frame reached. Every case builds its own: the ship mock is shared and hoisted, so a
 * case that inherited another's call log would pass on the previous case's frames.
 */
function createScene(): {
  context: never;
  frame: (ctx: never, deltaTime: number) => void;
  state: typeof Sailing.initialState;
} {
  const state = { ...Sailing.initialState };
  const context = {
    add: <T>(object: T): T => object,
    camera: {},
    entities: { add: <T>(_id: string, entity: T): T => entity },
    input: {
      justPressed: () => false,
      raw: { pointers: new Map() },
    },
    renderer: { raw: {} },
    scene: {},
    state: {
      flush: vi.fn(),
      getState: () => state,
      set: (patch: Partial<typeof state>) => Object.assign(state, patch),
    },
    viewport: { size: { aspect: 16 / 9, height: 720, width: 1280 } },
  } as never;

  const frame = new Sailing().enter(context);
  if (typeof frame !== "function") throw new Error("Sailing.enter returned no scene frame.");
  return { context, frame, state };
}

beforeEach(() => {
  fixture.order.length = 0;
  fixture.ocean.advance.mockClear();
  fixture.ship.update.mockClear();
  fixture.ship.updateVisual.mockClear();
  fixture.ship.capsize.mockClear();
  fixture.ship.mesh.position.z = 0;
  // Every mutable field on the shared mock, not just the ones a case happens to touch today: the
  // fixture is hoisted once for the whole file, so a field left dirty here is a case reading the
  // previous case's ship.
  fixture.ship.immersion = 0;
  fixture.ship.visual.position.y = 0;
});

describe("sailing scene ocean clock", () => {
  it("advances the ocean with increasing scene time before updating the ship", () => {
    const { context, frame } = createScene();

    frame(context, 0.25);
    frame(context, 0.5);

    expect(fixture.ocean.advance.mock.calls.map(([seconds]) => seconds)).toEqual([0.25, 0.75]);
    expect(fixture.order).toEqual(["ocean:0.25", "ship", "visual", "ocean:0.75", "ship", "visual"]);
  });
});

describe("sailing scene terminal states", () => {
  it("keeps riding the swell after the course is won, with gameplay stopped", () => {
    const { context, frame, state } = createScene();

    // Past the last buoy from the first frame, so four frames round the whole course.
    fixture.ship.mesh.position.z = -2;
    for (let index = 0; index < 4; index += 1) frame(context, 0.1);
    expect(state.status).toBe("won");

    const gameplayCallsAtWin = fixture.ship.update.mock.calls.length;
    const visualCallsAtWin = fixture.ship.updateVisual.mock.calls.length;
    fixture.order.length = 0;

    frame(context, 0.1);
    frame(context, 0.1);

    // The sea keeps moving under the hull, and the hull keeps being placed on it.
    expect(fixture.ocean.advance).toHaveBeenCalledTimes(6);
    expect(fixture.ship.updateVisual.mock.calls.length).toBe(visualCallsAtWin + 2);
    expect(fixture.order).toEqual(["ocean:0.5", "visual", "ocean:0.6", "visual"]);
    // Gameplay is locked out: no steering, no further buoys.
    expect(fixture.ship.update.mock.calls.length).toBe(gameplayCallsAtWin);
    expect(state.status).toBe("won");
    expect(state.buoysRounded).toBe(4);
  });

  it("keeps riding the swell after the wind expires, with gameplay stopped", () => {
    const { context, frame, state } = createScene();

    // Never reaches a buoy; the wind runs out at 45 s and the run is lost where it sits.
    fixture.ship.mesh.position.z = 7;
    frame(context, 44);
    expect(state.status).toBe("sailing");
    frame(context, 2);
    expect(state.status).toBe("lost");
    expect(state.wind).toBe(0);

    const gameplayCallsAtLoss = fixture.ship.update.mock.calls.length;
    const visualCallsAtLoss = fixture.ship.updateVisual.mock.calls.length;
    fixture.order.length = 0;

    frame(context, 1);
    frame(context, 1);

    expect(fixture.ship.updateVisual.mock.calls.length).toBe(visualCallsAtLoss + 2);
    expect(fixture.order).toEqual(["ocean:47", "visual", "ocean:48", "visual"]);
    expect(fixture.ship.update.mock.calls.length).toBe(gameplayCallsAtLoss);
    expect(state.status).toBe("lost");
  });
});

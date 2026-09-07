import { describe, expect, it, vi } from "vitest";

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

describe("sailing scene ocean clock", () => {
  it("advances the ocean with increasing scene time before updating the ship", () => {
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

    frame(context, 0.25);
    frame(context, 0.5);

    expect(fixture.ocean.advance.mock.calls.map(([seconds]) => seconds)).toEqual([0.25, 0.75]);
    expect(fixture.order).toEqual(["ocean:0.25", "ship", "ocean:0.75", "ship"]);
  });
});

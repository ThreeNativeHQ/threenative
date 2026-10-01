import * as RAPIER from "@dimforge/rapier3d-compat";
import { Object3D } from "three";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import "../src/web.js";
import { CollisionShape3D } from "../src/CollisionShape3D.js";
import { RigidBody3D } from "../src/RigidBody3D.js";
import { type IPhysicsSimulation, createWebPhysicsSimulation } from "../src/simulation.js";

const worlds: RAPIER.World[] = [];
const bodies: RigidBody3D[] = [];

function rawWorld(): RAPIER.World {
  const instance = new RAPIER.World({ x: 0, y: 0, z: 0 });
  instance.timestep = 1 / 60;
  worlds.push(instance);
  return instance;
}

function simulation(): IPhysicsSimulation {
  const instance = createWebPhysicsSimulation({
    eventQueue: new RAPIER.EventQueue(true),
    rapier: RAPIER,
    version: RAPIER.version(),
    world: rawWorld(),
  });
  return instance;
}

function bodyWithRawWorld(instance: RAPIER.World): RigidBody3D {
  const body = new RigidBody3D({
    object: new Object3D(),
    shape: CollisionShape3D.sphere(0.2),
    world: instance,
  });
  bodies.push(body);
  return body;
}

beforeAll(async () => {
  await RAPIER.init();
});

afterEach(() => {
  // The warning is once per *module instance*, and vitest gives each spec file its own registry —
  // so a case that needs the budget back resets the registry instead of reaching for a hook.
  vi.restoreAllMocks();
  for (const body of bodies.splice(0)) body.dispose();
  for (const instance of worlds.splice(0)) instance.free();
});

describe("deprecated physics constructor options", () => {
  it("warns once per process for the raw `world` option, and only when it is actually used", () => {
    const instance = rawWorld();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // A game that never touches the deprecated option must never see the warning, so the
    // not-deprecated path is asserted first: it would consume the once-per-process budget.
    expect(warn).not.toHaveBeenCalled();

    bodyWithRawWorld(instance);
    expect(warn).toHaveBeenCalledTimes(1);
    const note = String(warn.mock.calls[0]?.[0] ?? "");
    expect(note).toMatch(/TN_DEPRECATED_PHYSICS_WORLD_OPTION/u);
    expect(note).toContain("`world`");
    expect(note).toContain("`physics`");
    // The note is about one constructor option. An agent that reads "deprecated" without the
    // member name would stop using a node class that is not deprecated at all.
    expect(note).toMatch(/not deprecated/u);

    bodyWithRawWorld(instance);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("warns on the supplied option even when a context resolves the simulation first", async () => {
    vi.resetModules();
    const { requirePhysicsSimulation } = await import("../src/simulation.js");
    const current = simulation();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Both options supplied: the context wins, and the caller still has to hear that the option
    // they wrote is the one going away.
    expect(requirePhysicsSimulation({ simulation: current }, rawWorld())).toBe(current);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0] ?? "")).toMatch(/TN_DEPRECATED_PHYSICS_WORLD_OPTION/u);

    // The current path, on a fresh module so the budget is not already spent, stays silent.
    vi.restoreAllMocks();
    vi.resetModules();
    const quiet = await import("../src/simulation.js");
    const silence = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(quiet.requirePhysicsSimulation({ simulation: current }, undefined)).toBe(current);
    expect(silence).not.toHaveBeenCalled();
  });
});

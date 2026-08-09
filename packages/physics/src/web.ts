import * as RAPIER from "@dimforge/rapier3d-compat";
import {
  type PhysicsSimulation,
  createWebPhysicsShape,
  createWebPhysicsSimulation,
  installPhysicsSimulationBackend,
} from "./simulation.js";

let initialized: Promise<void> | undefined;
const simulations = new WeakMap<object, PhysicsSimulation>();

installPhysicsSimulationBackend({
  initialize: () => {
    initialized ??= RAPIER.init();
    return initialized;
  },
  createSimulation: (options = {}) => {
    const world = new RAPIER.World(options.gravity ?? { x: 0, y: -9.81, z: 0 });
    const simulation = createWebPhysicsSimulation({
      eventQueue: new RAPIER.EventQueue(true),
      rapier: RAPIER,
      version: RAPIER.version(),
      world,
    });
    simulations.set(world, simulation);
    return simulation;
  },
  simulationForWorld: (world) => {
    if (typeof world !== "object" || world === null)
      throw new Error("Physics nodes expected a Rapier World.");
    const simulation = simulations.get(world);
    if (simulation !== undefined) return simulation;
    const created = createWebPhysicsSimulation({
      eventQueue: new RAPIER.EventQueue(true),
      rapier: RAPIER,
      version: RAPIER.version(),
      world: world as RAPIER.World,
    });
    simulations.set(world, created);
    return created;
  },
  createShape: (shape) => createWebPhysicsShape(RAPIER, shape),
});

import * as rapier from "@dimforge/rapier3d-compat";
import {
  type IPhysicsSimulation,
  createWebPhysicsShape,
  createWebPhysicsSimulation,
  installPhysicsSimulationBackend,
} from "./simulation.js";

let initialized: Promise<void> | undefined;
const simulations = new WeakMap<object, IPhysicsSimulation>();
const RAPIER_INIT_WARNING =
  "using deprecated parameters for the initialization function; pass a single object instead";

function initializeRapier(): Promise<void> {
  const previousWarn = console.warn;
  console.warn = (...args) => {
    if (args[0] === RAPIER_INIT_WARNING) return;
    previousWarn(...args);
  };
  try {
    return rapier.init().finally(() => {
      console.warn = previousWarn;
    });
  } catch (error) {
    console.warn = previousWarn;
    throw error;
  }
}

installPhysicsSimulationBackend({
  initialize: () => {
    initialized ??= initializeRapier();
    return initialized;
  },
  createSimulation: (options = {}) => {
    const world = new rapier.World(options.gravity ?? { x: 0, y: -9.81, z: 0 });
    const simulation = createWebPhysicsSimulation({
      eventQueue: new rapier.EventQueue(true),
      rapier,
      version: rapier.version(),
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
      eventQueue: new rapier.EventQueue(true),
      rapier,
      version: rapier.version(),
      world: world as rapier.World,
    });
    simulations.set(world, created);
    return created;
  },
  createShape: (shape) => createWebPhysicsShape(rapier, shape),
});

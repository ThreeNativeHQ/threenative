import {
  createNativePhysicsSimulation,
  nativePhysicsHost,
  nativeSimulation,
} from "./native/host.js";
import { installPhysicsSimulationBackend } from "./simulation.js";
import type { IPhysicsSimulation } from "./simulation.js";

const simulations = new WeakMap<object, IPhysicsSimulation>();

function wrapNativeSimulation(raw: ReturnType<typeof nativeSimulation>, version: string) {
  const simulation = createNativePhysicsSimulation(raw, version);
  simulations.set(raw, simulation);
  return simulation;
}

installPhysicsSimulationBackend({
  initialize: async () => undefined,
  createSimulation: (options = {}) => {
    const host = nativePhysicsHost();
    return wrapNativeSimulation(nativeSimulation(host.createSimulation(options)), host.version);
  },
  createShape: (shape) => Object.freeze({ backend: "native", kind: shape.kind }),
  simulationForWorld: (world) => {
    if (typeof world !== "object" || world === null)
      throw new Error("TN_NATIVE_PHYSICS_INVALID: native world must be an object");
    const existing = simulations.get(world);
    if (existing !== undefined) return existing;
    const host = nativePhysicsHost();
    return wrapNativeSimulation(nativeSimulation(world), host.version);
  },
});

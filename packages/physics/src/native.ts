import { installPhysicsSimulationBackend } from "./simulation.js";
import { createNativePhysicsSimulation, nativePhysicsHost } from "./native/host.js";

installPhysicsSimulationBackend({
  initialize: async () => undefined,
  createSimulation: (options = {}) => {
    const host = nativePhysicsHost();
    return createNativePhysicsSimulation(host.createSimulation(options), host.version);
  },
});

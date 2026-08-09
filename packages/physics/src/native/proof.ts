import type { PhysicsProof, PhysicsProofOptions } from "../proof-contract.js";
import type { NativePhysicsHost } from "./host.js";
export { PHYSICS_COLLISION_EVENT_STRIDE } from "../proof-contract.js";
export type { PhysicsProof, PhysicsProofOptions } from "../proof-contract.js";

export async function createPhysicsProof(options: PhysicsProofOptions = {}): Promise<PhysicsProof> {
  const host = globalThis.__THREENATIVE_NATIVE__?.physics as NativePhysicsHost | undefined;
  if (host === undefined)
    throw new Error("TN_NATIVE_PHYSICS_MISSING: runtime did not install the physics ABI");
  if (typeof host.version !== "string" || typeof host.createProofSimulation !== "function")
    throw new Error("TN_NATIVE_PHYSICS_INVALID: runtime installed a malformed physics ABI");
  const simulation = host.createProofSimulation(options);
  for (const method of [
    "step",
    "readVisibleTransforms",
    "drainCollisionEvents",
    "dispose",
  ] as const) {
    if (typeof simulation[method] !== "function")
      throw new Error(`TN_NATIVE_PHYSICS_INVALID: simulation is missing ${method}`);
  }
  return {
    ...simulation,
    createBody: () => {
      throw new Error("Physics proof simulation does not expose general body creation.");
    },
    configureCharacter: () => {
      throw new Error("Physics proof simulation does not expose character configuration.");
    },
    removeBody: () => {
      throw new Error("Physics proof simulation does not expose general body removal.");
    },
    setBodyTransform: () => {
      throw new Error("Physics proof simulation does not expose body transforms.");
    },
    version: host.version,
  };
}

/**
 * Portable handle for a backend-owned physics object.
 *
 * `raw` is deliberately backend-specific: it is a Rapier object on web and an opaque
 * native handle on device. Code that reads it is not portable across build targets.
 */
export interface PhysicsHandle {
  readonly raw: unknown;
}

export interface PhysicsBodyHandle extends PhysicsHandle {
  readonly id: number;
}

export interface PhysicsColliderHandle extends PhysicsHandle {
  readonly id: number;
}

export interface PhysicsWorldHandle extends PhysicsHandle {
  /** The selected backend, kept beside `raw` so shared nodes do not inspect it. */
  readonly simulation?: unknown;
}

export function physicsHandle(raw: unknown): PhysicsHandle {
  return { raw };
}

export function physicsWorldHandle(raw: unknown, simulation: unknown): PhysicsWorldHandle {
  return { raw, simulation };
}

export function physicsBodyHandle(id: number, raw: unknown): PhysicsBodyHandle {
  return { id, raw };
}

export function physicsColliderHandle(id: number, raw: unknown): PhysicsColliderHandle {
  return { id, raw };
}

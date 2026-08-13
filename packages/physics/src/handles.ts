/**
 * Portable handle for a backend-owned physics object.
 *
 * `raw` is deliberately backend-specific: it is a Rapier object on web and an opaque
 * native handle on device. Code that reads it is not portable across build targets.
 */
export interface IPhysicsHandle {
  readonly raw: unknown;
}

export interface IPhysicsBodyHandle extends IPhysicsHandle {
  readonly id: number;
  readonly entity?: string;
}

export interface IPhysicsColliderHandle extends IPhysicsHandle {
  readonly id: number;
}

export interface IPhysicsWorldHandle extends IPhysicsHandle {
  /** The selected backend, kept beside `raw` so shared nodes do not inspect it. */
  readonly simulation?: unknown;
}

export function physicsHandle(raw: unknown): IPhysicsHandle {
  return { raw };
}

export function physicsWorldHandle(raw: unknown, simulation: unknown): IPhysicsWorldHandle {
  return { raw, simulation };
}

export function physicsBodyHandle(id: number, raw: unknown, entity?: string): IPhysicsBodyHandle {
  return { entity, id, raw };
}

export function physicsColliderHandle(id: number, raw: unknown): IPhysicsColliderHandle {
  return { id, raw };
}

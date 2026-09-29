import { BOUNDS, clamp } from "./terrain.js";

/** A circle on the xz-plane that stops bodies: a trunk, a boulder, the keeper. */
export interface IObstacle {
  readonly r: number;
  readonly x: number;
  readonly z: number;
}

export interface IPoint {
  x: number;
  z: number;
}

/**
 * Stick input to a world direction. `right` and `forward` are −1..1 in the camera's frame and
 * `yaw` is the orbit angle, so forward is always *away* from the camera. Length is capped at one,
 * so a diagonal is never faster than a straight line.
 */
export function moveDirection(
  right: number,
  forward: number,
  yaw: number,
  out: IPoint = { x: 0, z: 0 },
): IPoint {
  const length = Math.hypot(right, forward);
  const r = length > 1 ? right / length : right;
  const f = length > 1 ? forward / length : forward;
  out.x = r * Math.cos(yaw) - f * Math.sin(yaw);
  out.z = -r * Math.sin(yaw) - f * Math.cos(yaw);
  return out;
}

/**
 * Circle-versus-circles movement in 0.18 m sub-steps, sliding along whichever axis is free. A
 * fast roll therefore cannot tunnel through a trunk, and the hero slides round one rather than
 * stopping dead against it.
 */
export function moveWithCollisions(
  from: IPoint,
  dx: number,
  dz: number,
  obstacles: readonly IObstacle[],
  radius = 0.34,
  out: IPoint = { x: 0, z: 0 },
): IPoint {
  let x = from.x;
  let z = from.z;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.18));
  const legal = (a: number, b: number): boolean => {
    for (const c of obstacles) if (Math.hypot(a - c.x, b - c.z) < c.r + radius) return false;
    return true;
  };
  for (let i = 0; i < steps; i += 1) {
    const nx = clamp(x + dx / steps, BOUNDS.xMin, BOUNDS.xMax);
    const nz = clamp(z + dz / steps, BOUNDS.zMin, BOUNDS.zMax);
    if (legal(nx, nz)) {
      x = nx;
      z = nz;
    } else {
      if (legal(nx, z)) x = nx;
      if (legal(x, nz)) z = nz;
    }
  }
  out.x = x;
  out.z = z;
  return out;
}

/** Spends stamina if there is enough; a refused spend changes nothing. */
export function spendStamina(body: { stamina: number }, amount: number): boolean {
  if (body.stamina < amount) return false;
  body.stamina = Math.max(0, body.stamina - amount);
  return true;
}

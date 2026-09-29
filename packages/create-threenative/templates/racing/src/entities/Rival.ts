import type { IPathFollow3DProjection, PathFollow3D } from "@threenative/core";
import { MathUtils, Vector3 } from "three";
import { createMaterials } from "../render/materials.js";
import { CarBody, type CarCtx, FEEL, RIDE } from "./CarBody.js";

/**
 * The rival's pace, in m/s. It is a **constant**, not a function of the player: the old rival ran a
 * fixed 7.6 m/s along the route whatever the player did, and rubber-banding it towards or away from
 * the player would be the same lie with more code. A fixed pace is beatable, and it is honest.
 */
export const RIVAL_PACE = 11.5;

/** How far ahead of itself the rival aims, in metres, plus its own speed. */
const LOOKAHEAD_BASE = 3;
const LOOKAHEAD_PER_MPS = 0.35;

/** Steering gain: the fraction of the heading error it takes as steering input. */
const STEER_GAIN = 1.8;

/**
 * Wraps a distance step into ±half a lap, so crossing the line reads as one lap of progress rather
 * than as 144 metres backwards.
 */
function wrap(distance: number, half: number): number {
  const full = half * 2;
  return ((((distance + half) % full) + full) % full) - half;
}

/**
 * The heading error to a point ahead, wrapped to ±π and positive to the driver's right.
 *
 * Exported because the sign is the whole mechanic and a wrong one sends the rival into the tyre
 * walls at the first corner: this is pure arithmetic, and `__tests__/racing.spec.ts` pins it.
 */
export function headingError(yaw: number, target: Vector3, from: Vector3): number {
  const wanted = Math.atan2(target.z - from.z, target.x - from.x);
  return Math.atan2(Math.sin(wanted - yaw), Math.cos(wanted - yaw));
}

/**
 * The rival: a second `VehicleBody3D` on the same chassis, driven by a pure-pursuit controller
 * along `PathFollow3D`.
 *
 * It has a body, so the player cannot drive through it; it starts on its own grid slot, so the two
 * cars do not spawn inside each other; and it is ranked on its own measured position on the route,
 * so the order on the HUD is two cars rather than one car and a constant.
 */
export class Rival {
  readonly car: CarBody;
  /** Monotonic route progress in metres: it keeps counting past the line, a projection does not. */
  #progress: number;
  #lastProjected: number;
  #lap = 0;
  #yaw = 0;
  #projection: IPathFollow3DProjection = {
    distanceFromStart: 0,
    lateralDistance: 0,
    point: new Vector3(),
    segment: 0,
    tangent: new Vector3(0, 0, 1),
  };

  constructor(
    ctx: CarCtx,
    private readonly route: PathFollow3D,
    startDistance: number,
  ) {
    this.#progress = startDistance;
    this.#lastProjected = startDistance % route.totalLength;
    const sample = route.pointAt(startDistance);
    this.#yaw = Math.atan2(sample.tangent.z, sample.tangent.x);
    // Same sculpt, different livery: the rival was indistinguishable from the player in the first
    // frame because both cars asked for the same material set.
    const materials = createMaterials();
    this.car = new CarBody(ctx, {
      materials: { ...materials, body: materials.rivalBody },
      // The route is authored on the ground plane, so the spawn is its point raised to the chassis'
      // ride height: dropping the car in from above reads as a jump start.
      spawn: new Vector3(sample.point.x, RIDE, sample.point.z),
      yaw: this.#yaw,
    });
    this.car.measure(1 / 60);
  }

  /**
   * One frame of pursuit: aim at a point ahead **on the route**, then hold the pace with the same
   * torque curve the player uses.
   *
   * The distance along the route is the car's own **projected** position, not a clock. Advancing it
   * by `RIVAL_PACE * dt` instead means a rival that is slower than its pace — still accelerating off
   * the grid, or held up by something — falls behind its own target, aims at a point around the next
   * corner while it is still on the straight, and drives into the inside kerb. Projected, the target
   * can never outrun the car, and a car that stops simply aims at the road in front of it.
   */
  update(dt: number): void {
    const body = this.car.body;
    const speed = this.car.speedMagnitude;
    // Pure pursuit: aim further ahead the faster the car is going, so it stops sawing at the line.
    // A projection is 0…one lap, so a lap count read straight off it can never leave 0…1. The
    // progress is unwrapped instead: the projection's step is taken modulo half a lap, so crossing
    // the line forward adds a lap and crossing it backwards takes one off.
    const projected = this.route.project(this.car.position, this.#projection).distanceFromStart;
    const half = this.route.totalLength / 2;
    this.#progress += wrap(projected - this.#lastProjected, half);
    this.#lastProjected = projected;
    this.#lap = Math.max(0, Math.floor(this.#progress / this.route.totalLength));
    const target = this.route.pointAt(
      this.#progress + LOOKAHEAD_BASE + speed * LOOKAHEAD_PER_MPS,
    ).point;
    const error = headingError(this.#yaw, target, this.car.position);
    // The sign is flipped against the player's, because `headingError` is positive to the driver's
    // right and a positive Rapier steering angle is to its left.
    body.steering = -MathUtils.clamp(error * STEER_GAIN, -1, 1) * this.car.lockAt(speed);
    // Lift off when the line is asking for a big correction, so it does not arrive at a corner
    // already sideways, and hold its pace on the straights. The lift has a **floor**: a rival whose
    // target has swung behind it still needs drive, or a controller that only pushes forward
    // leaves it stationary against a barrier for the rest of the race — which is exactly what
    // happened here, measured, before the floor existed.
    const lift = Math.max(0.3, 1 - Math.abs(error) / 2);
    body.engineForce = FEEL.engineForce * Math.max(0, 1 - speed / RIVAL_PACE) * lift;
    body.brake = 0;
    this.#yaw = Math.atan2(this.car.forward.z, this.car.forward.x);
    this.car.measure(dt);
  }

  get mesh(): CarBody["mesh"] {
    return this.car.mesh;
  }

  get lap(): number {
    return this.#lap;
  }

  /** Monotonic route progress in metres, the same quantity the ranking orders cars by. */
  get distance(): number {
    return this.#progress;
  }

  get speed(): number {
    return this.car.speedMagnitude;
  }

  debug(): Record<string, unknown> {
    return {
      lap: this.#lap,
      position: this.car.position.toArray(),
      routeProgress: this.#progress,
      speed: this.speed,
    };
  }

  dispose(): void {
    this.car.dispose();
  }
}

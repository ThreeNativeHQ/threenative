import { MathUtils, type Vector3 } from "three";
import { Boost } from "../kart/boost.js";
import { createMaterials } from "../render/materials.js";
import type { ITouchInput } from "../render/touch-controls.js";
import { CarBody, type CarCtx, FEEL } from "./CarBody.js";

/**
 * The player's car: input in, a `VehicleBody3D` out.
 *
 * The old car was a kinematic fake — `#speed` and `#heading` as numbers, velocity rewritten every
 * frame, the chassis pinned level. Everything that made a car feel like a car lived in those two
 * numbers, so the same corner at the same speed always produced the same line. Here the input only
 * ever writes three values: `engineForce`, `brake` and `steering`. Grip, weight transfer, understeer
 * and the way a kerb lifts a wheel are the backend's, not this file's.
 */
export class RacingCar {
  readonly car: CarBody;
  readonly boost = new Boost();
  #speedAfterBoost = 0;
  #topSpeed = 0;
  #boostWasActive = false;

  constructor(ctx: CarCtx, spawn: Vector3) {
    this.car = new CarBody(ctx, { materials: createMaterials(), spawn, yaw: 0 });
    this.car.measure(1 / 60);
  }

  get body(): CarBody {
    return this.car;
  }

  /** The chassis root the physics writes its solved transform onto. */
  get mesh(): CarBody["mesh"] {
    return this.car.mesh;
  }

  get forward(): Vector3 {
    return this.car.forward;
  }

  /** Where the car is measured to be going. `Lap` reads this, never `forward`. */
  get travelDirection(): Vector3 {
    return this.car.travelDirection;
  }

  get normaliseFactor(): number {
    return this.car.normaliseFactor;
  }

  get lateralLoad(): number {
    return this.car.lateralLoad;
  }

  get speed(): number {
    return this.car.speedMagnitude;
  }

  get topSpeed(): number {
    return this.#topSpeed;
  }

  get boosting(): boolean {
    return this.boost.active;
  }

  /** The speed measured on the frame a boost ran out, which is what the boost playtest reads. */
  speedAfterBoost(): number {
    return this.#speedAfterBoost;
  }

  /**
   * One frame of driving: the input becomes an engine force, a brake and a steering angle.
   *
   * Reverse engages below half a metre per second, so holding back is a brake while the car is
   * rolling and a gear once it has stopped — the same rule every arcade racer uses, and the reason
   * a car can be backed out of a barrier rather than trapped against it.
   */
  update(ctx: CarCtx, dt: number, touch?: ITouchInput): void {
    this.boost.update(dt);
    if (ctx.input.justPressed("boost") || touch?.boostPressed === true) this.boost.activate();
    const move = ctx.input.vector("move");
    if (touch !== undefined) {
      move.x += touch.move.x;
      move.y += touch.move.y;
      move.clampLength(0, 1);
    }
    const body = this.car.body;
    const speed = body.speed;
    // The sign: `move.x` is +1 to the right, and a positive Rapier steering angle turns toward the
    // chassis's -z, which is the driver's left. Flipping here keeps "right means right" for the
    // physics and for the visual front wheels, which take the same angle.
    body.steering = -move.x * this.car.lockAt(speed);
    if (move.y > 0) {
      const top = this.boost.active ? FEEL.boostTopSpeed : FEEL.topSpeed;
      body.engineForce =
        move.y *
        FEEL.engineForce *
        (this.boost.active ? FEEL.boostForce : 1) *
        Math.max(0, 1 - speed / top);
      body.brake = 0;
    } else if (speed > FEEL.reverseEnterSpeed) {
      body.engineForce = 0;
      body.brake = FEEL.brake;
    } else {
      body.engineForce =
        move.y * FEEL.engineForce * Math.max(0, 1 - Math.abs(speed) / FEEL.reverseTopSpeed);
      body.brake = 0;
    }
    this.car.measure(dt);
    if (this.boost.active) {
      this.#boostWasActive = true;
    } else if (this.#boostWasActive) {
      this.#boostWasActive = false;
      this.#speedAfterBoost = this.speed;
    }
    this.#topSpeed = Math.max(this.#topSpeed, this.speed);
  }

  /** Places the car back on the road facing `heading`, which is what a rescue does. */
  setHeading(heading: Vector3): void {
    const flat = heading.clone().setY(0);
    if (flat.lengthSq() < 0.0001) return;
    flat.normalize();
    this.car.teleport(
      { x: this.car.position.x, y: this.car.position.y, z: this.car.position.z },
      Math.atan2(flat.z, flat.x),
    );
  }

  debug(): Record<string, unknown> {
    return {
      boostActive: this.boost.active,
      boostUses: this.boost.uses,
      lateralLoad: Math.round(this.lateralLoad * 100) / 100,
      normaliseFactor: this.car.normaliseFactor,
      position: this.car.position.toArray(),
      speed: this.speed,
      topSpeed: this.#topSpeed,
      travelDirection: this.travelDirection.toArray(),
      wheelsInContact: this.car.wheels.map((_wheel, index) => this.car.body.wheelContact(index)),
    };
  }

  dispose(): void {
    this.car.dispose();
  }
}

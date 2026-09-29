import type { PhysicsBody3D } from "@threenative/physics";
import { Vector3 } from "three";
import type { Checkline } from "./Checkline.js";

export interface ILapTarget {
  readonly body: PhysicsBody3D;
  /** Where the car is measured to be **going**, not where it points. */
  readonly forward: Vector3;
}

/**
 * Counts laps from an ordered set of lines across the road.
 *
 * The whole mechanic is in {@link observe}, and it is small on purpose: the car's transform is
 * swept between two frames, and a crossing is a **change of side** of one of the lines. That sees
 * every crossing exactly once — at 17 m/s a car moves 0.28 m per step, so it cannot pass through a
 * line and come back inside one frame — and it sees it in the order the car did it, which is what
 * makes the two rejections honest:
 *
 * - crossing **backwards** (the car's measured travel opposes the line) is a `reverseReject`: a car
 *   cannot bank a lap by rolling back over the start line.
 * - crossing **out of order** (line 2 before line 1) is a `shortcutReject`: a lap is only a lap if
 *   every line was crossed, in order, the right way.
 *
 * The car's **measured** travel direction decides the first one, never its heading: a car sliding
 * through a corner is travelling somewhere other than where it points, and a lap counted on the
 * intent is a lap counted on a wish.
 */
export class Lap {
  readonly totalLaps: number;
  completed = 0;
  expectedGate = 0;
  shortcutRejects = 0;
  reverseRejects = 0;
  #target: ILapTarget;
  #gates: readonly Checkline[];
  #onLap: (lap: number) => void;
  #targetDirection = new Vector3();
  #gateDirection = new Vector3();
  #before = new Vector3();
  #after = new Vector3();
  #mid = new Vector3();

  constructor(
    target: ILapTarget,
    gates: readonly Checkline[],
    totalLaps = 3,
    onLap: (lap: number) => void = () => undefined,
  ) {
    if (gates.length === 0) throw new Error("Lap requires at least one ordered gate.");
    if (!Number.isInteger(totalLaps) || totalLaps <= 0)
      throw new Error("Lap totalLaps must be positive.");
    this.#target = target;
    this.#gates = gates;
    this.totalLaps = totalLaps;
    this.#onLap = onLap;
  }

  /**
   * Records one crossing of gate `index`.
   *
   * Exported for a game that wants to judge a crossing itself; `observe` is the only caller in this
   * template, and every rejection below is measured rather than asserted.
   */
  cross(index: number): boolean {
    if (this.completed >= this.totalLaps) return false;
    const gate = this.#gates[index];
    if (gate === undefined) {
      this.shortcutRejects += 1;
      return false;
    }
    const travel = this.#targetDirection
      .copy(this.#target.forward)
      .setY(0)
      .normalize()
      .dot(this.#gateDirection.copy(gate.forward).setY(0).normalize());
    if (travel <= TRAVEL_LIMIT) {
      this.reverseRejects += 1;
      return false;
    }
    if (index !== this.expectedGate) {
      this.shortcutRejects += 1;
      return false;
    }
    this.expectedGate += 1;
    if (this.expectedGate < this.#gates.length) return true;
    this.expectedGate = 0;
    this.completed += 1;
    this.#onLap(this.completed);
    return true;
  }

  /** Sweeps a car transform between frames: one call per fixed step, before the physics runs. */
  observe(previous: Vector3, current: Vector3): void {
    for (let index = 0; index < this.#gates.length; index += 1) {
      const gate = this.#gates[index];
      if (gate === undefined) throw new Error("Lap gate is missing.");
      const before = this.#before.copy(previous).sub(gate.at).dot(gate.forward);
      const after = this.#after.copy(current).sub(gate.at).dot(gate.forward);
      if ((before < 0 && after >= 0) || (before >= 0 && after < 0)) {
        // Only where the line is drawn. The plane is infinite and a lap is a closed loop, so some
        // gates' planes cut other parts of the circuit: sector 2's plane is `x = 117`, and the main
        // straight runs along `x` from 25 to 195. Without this the main straight raises a reverse
        // rejection for a gate 300 m up the road.
        const across = this.#mid
          .copy(previous)
          .add(current)
          .multiplyScalar(0.5)
          .sub(gate.at)
          .dot(gate.across);
        if (Math.abs(across) <= gate.halfWidth) this.cross(index);
      }
    }
  }

  get won(): boolean {
    return this.completed >= this.totalLaps;
  }

  debug(): Record<string, unknown> {
    return {
      completed: this.completed,
      expectedGate: this.expectedGate,
      reverseRejects: this.reverseRejects,
      shortcutRejects: this.shortcutRejects,
      totalLaps: this.totalLaps,
      won: this.won,
    };
  }
}

/** How much of the line's own direction the car has to be travelling to count as crossing it. */
const TRAVEL_LIMIT = 0.2;

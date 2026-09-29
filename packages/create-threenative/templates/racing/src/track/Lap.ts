import type { PhysicsBody3D } from "@threenative/physics";
import { Vector3 } from "three";
import type { Checkline } from "./Checkline.js";

export interface ILapTarget {
  readonly body: PhysicsBody3D;
  /** Where the car is measured to be **going**, not where it points. */
  readonly forward: Vector3;
}

export class Lap {
  readonly totalLaps: number;
  completed = 0;
  expectedGate = 0;
  shortcutRejects = 0;
  reverseRejects = 0;
  #target: ILapTarget;
  #gates: readonly Checkline[];
  #gateNormals: Vector3[] = [];
  #onLap: (lap: number) => void;
  #unsubscribe: (() => void)[] = [];
  /**
   * Whether each gate will accept a crossing.
   *
   * Two things report the same crossing: the `Area3D` sensor the engine drains after the step, and
   * the swept plane test in {@link observe}, which exists so a fast body cannot skip a thin sensor.
   * The second one to arrive used to be counted as an out-of-order gate, so **every** legitimate
   * crossing also raised `shortcutRejects` — which is how a scenario could prove a shortcut was
   * rejected without the game ever being asked to take one. A gate re-arms only once the car is back
   * on the near side of its plane, so one pass counts once.
   */
  #armed: boolean[] = [];
  /**
   * Whether the car has been seen on the **far** side of each gate's plane since it was last armed.
   *
   * This is the second half of the arming rule and it is what makes one pass count once. The
   * `Area3D` sensor reports a crossing as soon as the car's collider touches the gate's box, which
   * on a gate 1.6 m thick is most of a metre *before* the plane. So the sensor counts the crossing
   * first, and the sweep a moment later sees the plane change sign while the car is still on the
   * near side — and a naive "re-arm whenever the car is on the near side" rule re-arms it in that
   * window, and the sweep's own crossing then reads as a second pass over the line. Measured: every
   * gate raised a `shortcutReject` for a car driving a clean lap.
   */
  #seenFarSide: boolean[] = [];
  #targetDirection = new Vector3();
  #gateDirection = new Vector3();
  #before = new Vector3();
  #after = new Vector3();

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
    for (let index = 0; index < gates.length; index += 1) {
      const gate = gates[index];
      if (gate === undefined) throw new Error("Lap gate is missing.");
      const expected = gate.forward.clone().setY(0).normalize();
      this.#gateNormals.push(expected);
      this.#armed.push(true);
      this.#seenFarSide.push(false);
      this.#unsubscribe.push(
        gate.area.on("bodyEntered", (body) => {
          if (body !== this.#target.body || this.completed >= this.totalLaps) return;
          this.cross(index, expected);
        }),
      );
    }
  }

  cross(index: number, gateForward?: Vector3): boolean {
    const gate = this.#gates[index];
    if (gate === undefined) {
      this.shortcutRejects += 1;
      return false;
    }
    if (this.#armed[index] !== true) return false;
    this.#armed[index] = false;
    const direction = gateForward ?? gate.forward;
    // The car's **measured** travel direction, so a car crossing a line sideways is rejected the way
    // a car crossing it backwards is.
    const travel = this.#targetDirection
      .copy(this.#target.forward)
      .setY(0)
      .normalize()
      .dot(this.#gateDirection.copy(direction).setY(0).normalize());
    if (travel <= 0.2) {
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

  /** Sweeps a car transform between frames so a fast body cannot skip a thin sensor. */
  observe(previous: Vector3, current: Vector3): void {
    for (let index = 0; index < this.#gates.length; index += 1) {
      const gate = this.#gates[index];
      if (gate === undefined) throw new Error("Lap gate is missing.");
      const normal = this.#gateNormals[index];
      if (normal === undefined) throw new Error("Lap gate normal is missing.");
      const before = this.#before.copy(previous).sub(gate.at).dot(normal);
      const after = this.#after.copy(current).sub(gate.at).dot(normal);
      // Only where the line is actually drawn. The plane is infinite and a lap is a closed loop,
      // so some gates' planes cut other parts of the circuit: sector 2's plane is `x = 117`, and
      // the main straight runs along `x` from 25 to 195. Without this the main straight raises a
      // reverse rejection for a gate 300 m up the road.
      const across = this.#after
        .copy(previous)
        .add(current)
        .multiplyScalar(0.5)
        .sub(gate.at)
        .dot(gate.across);
      if (Math.abs(across) > gate.halfWidth) continue;
      if (after >= 0) this.#seenFarSide[index] = true;
      // Back on the near side **having been on the far side**: whatever counted this gate has been
      // counted, and the next pass over is a real crossing again.
      if (after < 0 && this.#seenFarSide[index] === true) {
        this.#armed[index] = true;
        this.#seenFarSide[index] = false;
      }
      if ((before < 0 && after >= 0) || (before >= 0 && after < 0)) this.cross(index);
    }
  }

  get won(): boolean {
    return this.completed >= this.totalLaps;
  }

  debug(): Record<string, unknown> {
    return {
      armed: this.#armed.slice(),
      completed: this.completed,
      expectedGate: this.expectedGate,
      reverseRejects: this.reverseRejects,
      shortcutRejects: this.shortcutRejects,
      totalLaps: this.totalLaps,
      won: this.won,
    };
  }

  dispose(): void {
    for (const unsubscribe of this.#unsubscribe) unsubscribe();
    this.#unsubscribe = [];
  }
}
